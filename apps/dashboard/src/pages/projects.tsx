import { useState, type FormEvent } from "react";
import { FolderPlusIcon, PlusIcon } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
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
import { timeAgo } from "@/lib/format";
import { useCreateProject, useProjects } from "@/lib/queries";

export function ProjectsPage() {
  const { data: projects, isPending, error } = useProjects();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <NewProjectDialog />
      </div>

      {error ? (
        <ErrorState error={error} />
      ) : isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState icon={<FolderPlusIcon />} title="No projects yet">
          A project gets its own API key. Create one for each app you want to monitor.
          <div className="mt-4">
            <NewProjectDialog />
          </div>
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}/issues`} className="group">
              <Card className="h-full transition-colors group-hover:border-foreground/30">
                <CardHeader>
                  <CardTitle className="truncate">{p.name}</CardTitle>
                  <CardDescription>Created {timeAgo(p.createdAt)}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateProject();
  const navigate = useNavigate();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(name, {
      onSuccess: (project) => {
        setOpen(false);
        setName("");
        // Straight to setup: the new project has no events until the SDK is installed.
        navigate(`/projects/${project.id}/settings`);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Usually one per app, e.g. "web" or "api".</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              required
              maxLength={100}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {create.isError && (
            <p role="alert" className="text-sm text-destructive">
              Could not create the project. Try again.
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
