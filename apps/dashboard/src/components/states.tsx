import type { ReactNode } from "react";
import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiError } from "@/lib/api";

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>
      <h2 className="text-base font-medium">{title}</h2>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>{notFound ? "Not found" : "Something went wrong"}</AlertTitle>
      <AlertDescription>
        {notFound
          ? "It may have been deleted, or you may not have access to it."
          : "The request failed. Check that the API is running and try again."}
      </AlertDescription>
    </Alert>
  );
}
