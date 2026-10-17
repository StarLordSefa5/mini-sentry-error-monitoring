import { useState } from "react";
import type { ProjectDto } from "@mini-sentry/shared";
import { CheckIcon, CopyIcon, RefreshCwIcon, SendIcon } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProject, useRotateKey } from "@/lib/queries";

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
