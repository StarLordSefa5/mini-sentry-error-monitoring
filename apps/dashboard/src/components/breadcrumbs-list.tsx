import type { Breadcrumb, BreadcrumbType } from "@mini-sentry/shared";
import {
  GlobeIcon,
  MousePointerClickIcon,
  RouteIcon,
  TagIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<BreadcrumbType, LucideIcon> = {
  click: MousePointerClickIcon,
  navigation: RouteIcon,
  fetch: GlobeIcon,
  console: TerminalIcon,
  custom: TagIcon,
};

/** "-2.4s": how long before the error each breadcrumb happened. */
function offset(crumb: string, error: string): string {
  const ms = new Date(crumb).getTime() - new Date(error).getTime();
  if (!Number.isFinite(ms)) return "";
  const seconds = ms / 1000;
  if (Math.abs(seconds) < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds / 60)}m`;
}

function details(crumb: Breadcrumb): string | null {
  if (!crumb.data) return null;
  if (crumb.type === "fetch") {
    const { status, duration_ms: duration, error } = crumb.data;
    if (error) return String(error);
    return [status, duration !== undefined ? `${duration} ms` : null]
      .filter((v) => v != null)
      .join(" · ");
  }
  if (crumb.type === "navigation") return null;
  return Object.entries(crumb.data)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
}

/** What happened before the error, oldest first, ending with the error itself. */
export function BreadcrumbsList({
  breadcrumbs,
  errorTime,
  errorLabel,
}: {
  breadcrumbs: Breadcrumb[];
  errorTime: string;
  errorLabel: string;
}) {
  if (breadcrumbs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No breadcrumbs. The SDK records clicks, requests, route changes and console output before an
        error.
      </p>
    );
  }

  return (
    <ol className="divide-y overflow-hidden rounded-lg border text-sm">
      {breadcrumbs.map((crumb, i) => {
        const Icon = ICONS[crumb.type] ?? TagIcon;
        const extra = details(crumb);
        const isError = crumb.level === "error";
        return (
          <li key={i} className="grid grid-cols-[1.25rem_1fr_auto] items-start gap-3 px-3 py-2">
            <Icon
              className={cn(
                "mt-0.5 size-4",
                isError ? "text-destructive" : "text-muted-foreground",
              )}
              aria-label={crumb.type}
            />
            <div className="min-w-0">
              <p className={cn("break-words font-mono text-xs", isError && "text-destructive")}>
                {crumb.message}
              </p>
              {extra && <p className="text-xs text-muted-foreground">{extra}</p>}
            </div>
            <span className="text-xs tabular-nums text-muted-foreground" title={crumb.timestamp}>
              {offset(crumb.timestamp, errorTime)}
            </span>
          </li>
        );
      })}
      <li className="grid grid-cols-[1.25rem_1fr_auto] items-start gap-3 bg-destructive/10 px-3 py-2">
        <span className="mt-1.5 size-2 justify-self-center rounded-full bg-destructive" />
        <p className="font-mono text-xs font-semibold text-destructive">{errorLabel}</p>
        <span className="text-xs text-muted-foreground">0.0s</span>
      </li>
    </ol>
  );
}
