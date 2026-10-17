import { useEffect, useState } from "react";
import { CheckCircle2Icon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { EmptyState, ErrorState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatCount, formatDateTime, timeAgo } from "@/lib/format";
import { useIssues, type IssueListParams } from "@/lib/queries";

const STATUSES: { value: IssueListParams["status"]; label: string }[] = [
  { value: "unresolved", label: "Unresolved" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
  { value: "all", label: "All" },
];

const SORTS: { value: IssueListParams["sort"]; label: string }[] = [
  { value: "lastSeen", label: "Last seen" },
  { value: "firstSeen", label: "First seen" },
  { value: "count", label: "Events" },
];

export function IssuesPage() {
  const { projectId } = useParams() as { projectId: string };
  const navigate = useNavigate();
  // Filters live in the URL, so a filtered list can be shared and survives a reload.
  const [search, setSearch] = useSearchParams();
  const params: IssueListParams = {
    status: (search.get("status") as IssueListParams["status"]) ?? "unresolved",
    sort: (search.get("sort") as IssueListParams["sort"]) ?? "lastSeen",
    q: search.get("q") ?? "",
    page: Math.max(1, Number(search.get("page")) || 1),
  };
  const { data, isPending, isFetching, error } = useIssues(projectId, params);

  const update = (changes: Partial<Record<keyof IssueListParams, string>>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Any filter change starts again from page 1.
    if (!("page" in changes)) next.delete("page");
    setSearch(next, { replace: true });
  };

  // Typing updates the URL after a short pause instead of on every key.
  const [query, setQuery] = useState(params.q);
  useEffect(() => {
    if (query === params.q) return;
    const timer = setTimeout(() => update({ q: query.trim() }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [query]);

  const from = data ? (data.page - 1) * data.limit + 1 : 0;
  const to = data ? Math.min(data.page * data.limit, data.total) : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Tabs value={params.status} onValueChange={(status) => update({ status })}>
          <TabsList>
            {STATUSES.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative md:ml-auto md:w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search type, message or location"
            aria-label="Search issues"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={params.sort} onValueChange={(sort) => update({ sort })}>
          <SelectTrigger className="md:w-36" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <ErrorState error={error} />
      ) : isPending ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : data.issues.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2Icon />}
          title={
            params.q
              ? "No issues match your search"
              : `No ${params.status === "all" ? "" : params.status} issues`
          }
        >
          {params.q || params.status !== "unresolved" ? (
            "Try another filter."
          ) : (
            <>
              Nothing is broken, or the SDK is not installed yet.{" "}
              <Link to={`/projects/${projectId}/settings`} className="underline underline-offset-4">
                Set up the SDK
              </Link>{" "}
              and send a test error.
            </>
          )}
        </EmptyState>
      ) : (
        <>
          <div className={isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Issue</TableHead>
                    <TableHead className="w-16 text-right sm:w-24">Events</TableHead>
                    <TableHead className="hidden w-36 md:table-cell">First seen</TableHead>
                    <TableHead className="w-28 sm:w-36">Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.issues.map((issue) => {
                    const href = `/projects/${projectId}/issues/${issue.id}`;
                    return (
                      <TableRow
                        key={issue.id}
                        className="cursor-pointer"
                        onClick={() => navigate(href)}
                      >
                        <TableCell className="max-w-0 py-3">
                          <div className="flex min-w-0 items-center gap-2">
                            {/* A real link too, for keyboard users and opening in a new tab. */}
                            <Link
                              to={href}
                              onClick={(e) => e.stopPropagation()}
                              className="truncate font-medium hover:underline"
                            >
                              {issue.type}
                            </Link>
                            {params.status === "all" && (
                              <span className="hidden shrink-0 sm:inline-flex">
                                <StatusBadge status={issue.status} />
                              </span>
                            )}
                          </div>
                          <p className="truncate text-sm text-muted-foreground">{issue.message}</p>
                          {issue.culprit && (
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {issue.culprit}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCount(issue.count)}
                        </TableCell>
                        <TableCell
                          className="hidden text-sm text-muted-foreground md:table-cell"
                          title={formatDateTime(issue.firstSeen)}
                        >
                          {timeAgo(issue.firstSeen)}
                        </TableCell>
                        <TableCell className="text-sm" title={formatDateTime(issue.lastSeen)}>
                          {timeAgo(issue.lastSeen)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {from}–{to} of {formatCount(data.total)}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => update({ page: String(data.page - 1) })}
              >
                <ChevronLeftIcon /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={to >= data.total}
                onClick={() => update({ page: String(data.page + 1) })}
              >
                Next <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
