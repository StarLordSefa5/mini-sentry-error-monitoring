import { Navigate, Outlet, useLocation } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/lib/queries";

/** Renders child routes for logged-in users and sends everyone else to /login. */
export function RequireAuth() {
  const { data: user, isPending } = useMe();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}
