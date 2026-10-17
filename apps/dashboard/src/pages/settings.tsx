import { useState, type FormEvent } from "react";
import type { ProjectDto } from "@mini-sentry/shared";
import {
  BellIcon,
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import {
  useCreateUploadToken,
  useDeleteSourceMaps,
  useProject,
  useRotateKey,
  useSourceMaps,
  useTestAlert,
  useUpdateProject,
} from "@/lib/queries";

const SDK_PACKAGE = "@mini-sentry/sdk";

export function SettingsPage() {
  const { projectId } = useParams() as { projectId: string };
  const { data: project, isPending, error } = useProject(projectId);

  if (error) return <ErrorState error={error} />;
  if (isPending) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">{project.name}</p>
      </div>
      <SetupCard project={project} />
      <AlertsCard project={project} />
      <SourceMapsCard project={project} />
      <KeysCard project={project} />
    </div>
  );
}

function SetupCard({ project }: { project: ProjectDto }) {
  const browser = `import { init } from "${SDK_PACKAGE}";

init({
  dsn: "${project.dsn}",
  release: "my-app@1.0.0",
});`;
  const node = `import { init } from "${SDK_PACKAGE}/node";

init({ dsn: "${project.dsn}" });`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up the SDK</CardTitle>
        <CardDescription>
          Uncaught errors and unhandled promise rejections are then reported automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Step n={1} title="Install the package">
          <Code>{`npm install ${SDK_PACKAGE}`}</Code>
        </Step>
        <Step n={2} title="Initialise it as early as possible">
          <Tabs defaultValue="browser">
            <TabsList>
              <TabsTrigger value="browser">Browser</TabsTrigger>
              <TabsTrigger value="node">Node.js</TabsTrigger>
            </TabsList>
            <TabsContent value="browser" className="space-y-2">
              <Code>{browser}</Code>
              <p className="text-sm text-muted-foreground">
                Put this at the top of your entry file (e.g. <code>main.tsx</code>). Report errors
                you catch yourself with <code>captureException(error)</code>.
              </p>
            </TabsContent>
            <TabsContent value="node" className="space-y-2">
              <Code>{node}</Code>
              <p className="text-sm text-muted-foreground">
                After reporting a crash, the process exits with code 1 as Node would. Pass{" "}
                <code>exitOnError: false</code> to handle that yourself.
              </p>
            </TabsContent>
          </Tabs>
        </Step>
        <Step n={3} title="Check it works">
          <TestEventButton project={project} />
        </Step>
      </CardContent>
    </Card>
  );
}

function TestEventButton({ project }: { project: ProjectDto }) {
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();

  const send = async () => {
    setSending(true);
    try {
      // Goes through the public ingestion endpoint with the project key, exactly like the SDK.
      const base = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(`${base}/api/${project.id}/events?key=${project.apiKey}`, {
        method: "POST",
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          platform: "browser",
          type: "Error",
          message: "This is a test error from Mini Sentry settings",
          frames: [{ filename: location.origin + "/settings", function: "sendTestEvent" }],
          url: location.href,
          userAgent: navigator.userAgent,
          environment: "test",
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success("Test error sent", {
        description: "It shows up under Issues in a moment.",
        action: { label: "View", onClick: () => navigate(`/projects/${project.id}/issues`) },
      });
    } catch {
      toast.error("Could not send the test error.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={send} disabled={sending}>
        <SendIcon /> {sending ? "Sending…" : "Send a test error"}
      </Button>
      <Link
        to={`/projects/${project.id}/issues`}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Go to issues
      </Link>
    </div>
  );
}

function AlertsCard({ project }: { project: ProjectDto }) {
  const [url, setUrl] = useState(project.alertWebhookUrl ?? "");
  const update = useUpdateProject(project.id);
  const test = useTestAlert(project.id);
  const saved = project.alertWebhookUrl ?? "";
  const dirty = url.trim() !== saved;

  const save = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      { alertWebhookUrl: url.trim() || null },
      {
        onSuccess: (p) =>
          toast.success(p.alertWebhookUrl ? "Alerts turned on" : "Alerts turned off"),
      },
    );
  };

  const saveError =
    update.error instanceof ApiError
      ? (update.error.detail ?? "Could not save the webhook.")
      : update.error
        ? "Could not save the webhook."
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alerts</CardTitle>
        <CardDescription>
          Get a message in Discord or Slack when a new issue appears or a resolved issue comes back.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="webhook">Webhook URL</Label>
            <Input
              id="webhook"
              type="url"
              inputMode="url"
              placeholder="https://discord.com/api/webhooks/… or https://hooks.slack.com/services/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={saveError ? true : undefined}
              aria-describedby="webhook-help"
            />
            <p id="webhook-help" className="text-sm text-muted-foreground">
              Discord: channel settings → Integrations → Webhooks. Slack: an app with Incoming
              Webhooks. Leave empty to turn alerts off.
            </p>
            {saveError && (
              <p role="alert" className="text-sm text-destructive">
                {saveError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!dirty || update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!saved || dirty || test.isPending}
              onClick={() =>
                test.mutate(undefined, {
                  onSuccess: () => toast.success("Test notification sent"),
                  onError: (err) =>
                    toast.error("The webhook did not accept the message", {
                      description: err instanceof ApiError ? err.detail : undefined,
                    }),
                })
              }
            >
              <BellIcon /> {test.isPending ? "Sending…" : "Send test notification"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SourceMapsCard({ project }: { project: ProjectDto }) {
  const [token, setToken] = useState<string | null>(null);
  const create = useCreateUploadToken(project.id);
  const { data: releases } = useSourceMaps(project.id);
  const remove = useDeleteSourceMaps(project.id);

  const command = `MINI_SENTRY_UPLOAD_TOKEN=${token ?? "<your token>"} \\
  npx @mini-sentry/cli sourcemaps upload dist \\
  --release my-app@1.0.0 --dsn "${project.dsn}" --delete-after`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Source maps</CardTitle>
        <CardDescription>
          Upload your build's source maps from CI, and errors from minified code show the original
          file, line and code. Use the same release name in <code>init()</code> and in the upload.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Step n={1} title="Create an upload token">
          {token ? (
            <div className="space-y-2">
              <Field label="Upload token" value={token} />
              <p role="status" className="text-sm text-muted-foreground">
                Copy it now and store it as a CI secret. It will not be shown again.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={create.isPending}
                onClick={() =>
                  create.mutate(undefined, {
                    onSuccess: setToken,
                    onError: () => toast.error("Could not create a token."),
                  })
                }
              >
                <KeyRoundIcon /> {project.hasUploadToken ? "Replace token" : "Create token"}
              </Button>
              <p className="text-sm text-muted-foreground">
                {project.hasUploadToken
                  ? "A token exists. Replacing it stops the old one from working."
                  : "Secret, unlike the DSN: never put it in your app's code."}
              </p>
            </div>
          )}
        </Step>
        <Step n={2} title="Upload after each build">
          <Code>{command}</Code>
          <p className="text-sm text-muted-foreground">
            <code>--delete-after</code> removes the maps from <code>dist</code>, so your original
            code is not published with the site.
          </p>
        </Step>
        <Step n={3} title="Uploaded releases">
          {!releases?.length ? (
            <p className="text-sm text-muted-foreground">No source maps uploaded yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {releases.map((r) => (
                <li key={r.release} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs">{r.release}</p>
                    <p
                      className="text-xs text-muted-foreground"
                      title={formatDateTime(r.lastUploadAt)}
                    >
                      {r.files} file{r.files === 1 ? "" : "s"} · {(r.bytes / 1024).toFixed(0)} KB ·{" "}
                      {timeAgo(r.lastUploadAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete source maps for ${r.release}`}
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(r.release, {
                        onSuccess: () => toast.success(`Deleted source maps for ${r.release}`),
                      })
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Step>
      </CardContent>
    </Card>
  );
}

function KeysCard({ project }: { project: ProjectDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Keys</CardTitle>
        <CardDescription>
          The key is public: it ships in your frontend code and can only send events. Managing this
          project always needs your login.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="DSN" value={project.dsn} />
        <Field label="API key" value={project.apiKey} />
        <RotateKeyDialog projectId={project.id} />
      </CardContent>
    </Card>
  );
}

function RotateKeyDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const rotate = useRotateKey(projectId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <RefreshCwIcon /> Rotate key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate the API key?</DialogTitle>
          <DialogDescription>
            Apps using the current key stop being able to send errors within a minute. Update the
            DSN in every app that uses it. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={rotate.isPending}
            onClick={() =>
              rotate.mutate(undefined, {
                onSuccess: () => {
                  setOpen(false);
                  toast.success("New key created", { description: "Update the DSN in your apps." });
                },
                onError: () => toast.error("Could not rotate the key."),
              })
            }
          >
            {rotate.isPending ? "Rotating…" : "Rotate key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1.75rem_1fr] gap-3">
      <span className="flex size-7 items-center justify-center rounded-full bg-muted text-sm font-medium">
        {n}
      </span>
      <div className="min-w-0 space-y-2">
        <p className="pt-0.5 font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-muted p-4 pr-12 font-mono text-xs leading-relaxed">
        {children}
      </pre>
      <CopyButton value={children} className="absolute top-2 right-2" />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={copied ? "Copied" : "Copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Copy failed. Select the text and copy it manually.");
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
