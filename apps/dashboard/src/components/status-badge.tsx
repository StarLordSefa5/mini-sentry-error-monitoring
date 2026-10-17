import type { IssueStatus } from "@mini-sentry/shared";
import { Badge } from "@/components/ui/badge";

const LABELS: Record<IssueStatus, string> = {
  unresolved: "Unresolved",
  resolved: "Resolved",
  ignored: "Ignored",
};

export function StatusBadge({ status }: { status: IssueStatus }) {
  return (
    <Badge
      variant={
        status === "unresolved" ? "destructive" : status === "resolved" ? "secondary" : "outline"
      }
    >
      {LABELS[status]}
    </Badge>
  );
}
