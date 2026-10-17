import { useState, type ReactNode } from "react";
import type { EventDto, IssueStatus, StatsRange } from "@mini-sentry/shared";
import { ArrowLeftIcon, CheckIcon, EyeOffIcon, RotateCcwIcon } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { EventsChart } from "@/components/events-chart";
import { StackTrace } from "@/components/stack-trace";
import { ErrorState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { breakdown, formatCount, formatDateTime, parseUserAgent, timeAgo } from "@/lib/format";
import { useIssue, useIssueEvents, useIssueStats, useUpdateIssueStatus } from "@/lib/queries";

export function IssueDetailPage() {
  const { projectId, issueId } = useParams() as { projectId: string; issueId: string };
  const { data, isPending, error } = useIssue(projectId, issueId);
  const back = `/projects/${projectId}/issues`;

  if (error) return <ErrorState error={error} />;
  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const { issue, latestEvent } = data;
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          to={back}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> Issues
        </Link>
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{issue.type}</h1>
              <StatusBadge status={issue.status} />
            </div>
            <p className="break-words text-muted-foreground">{issue.message}</p>
            {issue.culprit && (
              <p className="font-mono text-xs text-muted-foreground">{issue.culprit}</p>
            )}
          </div>
          <StatusActions projectId={projectId} issueId={issueId} status={issue.status} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Events">{formatCount(issue.count)}</Stat>
        <Stat label="First seen" title={formatDateTime(issue.firstSeen)}>
          {timeAgo(issue.firstSeen)}
        </Stat>
        <Stat label="Last seen" title={formatDateTime(issue.lastSeen)}>
          {timeAgo(issue.lastSeen)}
        </Stat>
      </div>

      <ChartCard projectId={projectId} issueId={issueId} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2 lg:self-start">
          <CardHeader>
            <CardTitle>Stack trace</CardTitle>
          </CardHeader>
          <CardContent>
            {latestEvent ? (
              <StackTrace frames={latestEvent.frames} raw={latestEvent.stack} />
            ) : (
              <p className="text-sm text-muted-foreground">No events stored for this issue.</p>
            )}
          </CardContent>
        </Card>
        <div className="space-y-6">
          {latestEvent && <LatestEventCard event={latestEvent} />}
          <BreakdownCard projectId={projectId} issueId={issueId} />
        </div>
      </div>

      <RecentEvents projectId={projectId} issueId={issueId} />
    </div>
  );
}

function StatusActions({
  projectId,
  issueId,
  status,
}: {
  projectId: string;
  issueId: string;
  status: IssueStatus;
}) {
  const update = useUpdateIssueStatus(projectId, issueId);
  const set = (next: IssueStatus, message: string) =>
    update.mutate(next, {
      onSuccess: () => toast.success(message),
      onError: () => toast.error("Could not update the issue."),
    });

  if (status !== "unresolved") {
    return (
      <Button
        variant="outline"
        disabled={update.isPending}
        onClick={() => set("unresolved", "Issue reopened")}
      >
        <RotateCcwIcon /> Reopen
      </Button>
    );
  }
  return (
    <div className="flex gap-2">
      <Button disabled={update.isPending} onClick={() => set("resolved", "Marked as resolved")}>
        <CheckIcon /> Resolve
      </Button>
      <Button
        variant="outline"
        disabled={update.isPending}
        onClick={() => set("ignored", "Issue ignored")}
      >
        <EyeOffIcon /> Ignore
      </Button>
    </div>
  );
}

function Stat({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardContent title={title}>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{children}</p>
      </CardContent>
    </Card>
  );
}

function ChartCard({ projectId, issueId }: { projectId: string; issueId: string }) {
  const [range, setRange] = useState<StatsRange>("24h");
  const { data } = useIssueStats(projectId, issueId, range);
  const total = data?.buckets.reduce((sum, b) => sum + b.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Events{" "}
          {total !== undefined && (
            <span className="font-normal text-muted-foreground">
              · {formatCount(total)} in the last {range === "24h" ? "24 hours" : "7 days"}
            </span>
          )}
        </CardTitle>
        <CardAction>
          <Tabs value={range} onValueChange={(v) => setRange(v as StatsRange)}>
            <TabsList>
              <TabsTrigger value="24h">24h</TabsTrigger>
              <TabsTrigger value="7d">7d</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent>
        {data ? <EventsChart stats={data} /> : <Skeleton className="h-48" />}
      </CardContent>
    </Card>
  );
}

function LatestEventCard({ event }: { event: EventDto }) {
  const client = parseUserAgent(event.userAgent);
  const rows: [string, ReactNode][] = [
    ["When", <span title={formatDateTime(event.receivedAt)}>{timeAgo(event.receivedAt)}</span>],
    ["Browser", client.browser],
    ["OS", client.os],
    ["URL", event.url],
    ["Release", event.release],
    ["Environment", event.environment],
    ["Event ID", <span className="font-mono text-xs">{event.eventId}</span>],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest event</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {rows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="grid grid-cols-[6rem_1fr] gap-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-all">{value}</dd>
              </div>
            ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ projectId, issueId }: { projectId: string; issueId: string }) {
  const { data: events } = useIssueEvents(projectId, issueId);
  if (!events?.length) return null;

  const clients = events.map((e) => parseUserAgent(e.userAgent));
  const groups: [string, [string, number][]][] = [
    ["Browsers", breakdown(clients.map((c) => c.browser))],
    ["Operating systems", breakdown(clients.map((c) => c.os))],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Affected clients{" "}
          <span className="font-normal text-muted-foreground">· last {events.length} events</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map(([title, rows]) => (
          <div key={title} className="space-y-2">
            <p className="text-sm font-medium">{title}</p>
            {rows.map(([name, share]) => (
              <div key={name} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {Math.round(share * 100)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-chart-1"
                    style={{ width: `${share * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RecentEvents({ projectId, issueId }: { projectId: string; issueId: string }) {
  const { data: events } = useIssueEvents(projectId, issueId);
  if (!events?.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent events</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Browser</TableHead>
              <TableHead>OS</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Release</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => {
              const client = parseUserAgent(e.userAgent);
              return (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap" title={formatDateTime(e.receivedAt)}>
                    {timeAgo(e.receivedAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{client.browser}</TableCell>
                  <TableCell className="whitespace-nowrap">{client.os}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">
                    {e.url ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {e.release ?? "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
