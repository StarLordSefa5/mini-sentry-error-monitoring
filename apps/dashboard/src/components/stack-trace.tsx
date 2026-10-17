import { useState } from "react";
import type { StackFrame } from "@mini-sentry/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const isLibrary = (f: StackFrame) =>
  /^node:|[/\\]node_modules[/\\]|^<anonymous>$|^native$/.test(f.filename);

/** Frames innermost first. Library frames are dimmed and can be hidden; raw text is one click away. */
export function StackTrace({ frames, raw }: { frames: StackFrame[]; raw: string | null }) {
  const [showRaw, setShowRaw] = useState(frames.length === 0 && Boolean(raw));
  const [showLibrary, setShowLibrary] = useState(false);
  const libraryCount = frames.filter(isLibrary).length;
  const visible = showLibrary ? frames : frames.filter((f) => !isLibrary(f));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">Most recent call first</p>
        <div className="ml-auto flex gap-2">
          {libraryCount > 0 && !showRaw && (
            <Button variant="ghost" size="xs" onClick={() => setShowLibrary(!showLibrary)}>
              {showLibrary ? "Hide" : "Show"} {libraryCount} library frame
              {libraryCount === 1 ? "" : "s"}
            </Button>
          )}
          {raw && (
            <Button variant="outline" size="xs" onClick={() => setShowRaw(!showRaw)}>
              {showRaw ? "Frames" : "Raw"}
            </Button>
          )}
        </div>
      </div>

      {showRaw ? (
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed">
          {raw}
        </pre>
      ) : frames.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stack trace was captured for this event.</p>
      ) : (
        <ol className="divide-y overflow-hidden rounded-lg border font-mono text-xs">
          {(visible.length ? visible : frames).map((frame, i) => (
            <li
              key={i}
              className={cn(
                "flex flex-wrap items-baseline gap-x-2 px-3 py-2",
                isLibrary(frame) ? "text-muted-foreground" : i === 0 && "bg-muted/60",
              )}
            >
              <span className="font-semibold">{frame.function ?? "<anonymous>"}</span>
              <span className="text-muted-foreground">in</span>
              <span className="break-all">
                {frame.filename}
                {frame.lineno !== undefined && (
                  <span className="text-muted-foreground">
                    :{frame.lineno}
                    {frame.colno !== undefined && `:${frame.colno}`}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
