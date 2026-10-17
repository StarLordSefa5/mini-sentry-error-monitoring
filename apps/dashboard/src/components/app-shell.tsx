import { BugIcon, ChevronDownIcon, LogOutIcon, UserIcon } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useLogout, useMe, useProjects } from "@/lib/queries";

export function AppShell() {
  const { projectId } = useParams();
  const { data: user } = useMe();
  const { data: projects } = useProjects();
  const logout = useLogout();
  const navigate = useNavigate();
  const current = projects?.find((p) => p.id === projectId);

  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <Link to="/projects" className="flex items-center gap-2 font-semibold">
            <BugIcon className="size-5" />
            <span className="hidden sm:inline">Mini Sentry</span>
          </Link>

          {projects && projects.length > 0 && (
            <>
              <span className="text-muted-foreground">/</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="max-w-32 gap-1 sm:max-w-48">
                    <span className="truncate">{current?.name ?? "Projects"}</span>
                    <ChevronDownIcon className="size-4 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel>Projects</DropdownMenuLabel>
                  {projects.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onSelect={() => navigate(`/projects/${p.id}/issues`)}
                    >
                      <span className="truncate">{p.name}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate("/projects")}>
                    All projects
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          {projectId && (
            <nav className="flex items-center gap-1">
              <NavLink to={`/projects/${projectId}/issues`} className={tab}>
                Issues
              </NavLink>
              <NavLink to={`/projects/${projectId}/settings`} className={tab}>
                Settings
              </NavLink>
            </nav>
          )}

          <div className="ml-auto shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="max-w-56" aria-label="Account">
                  <UserIcon className="sm:hidden" />
                  <span className="hidden truncate sm:inline">{user?.name ?? user?.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="font-normal text-muted-foreground">
                  {user?.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => logout.mutate(undefined, { onSuccess: () => navigate("/login") })}
                >
                  <LogOutIcon /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
