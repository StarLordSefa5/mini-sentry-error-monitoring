import { useState } from "react";
import type { StackFrame } from "@mini-sentry/shared";
import { ChevronRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const isLibrary = (f: StackFrame) =>
  /^node:|[/\\]node_modules[/\\]|^node_modules[/\\]|^<anonymous>$|^native$/.test(f.filename);

/** Frames innermost first. Library frames are dimmed and can be hidden; raw text is one click away. */
export function StackTrace({ frames, raw }: { frames: StackFrame[]; raw: string | null }) {
  const [showRaw, setShowRaw] = useState(frames.length === 0 && Boolean(raw));
  const [showLibrary, setShowLibrary] = useState(false);
  const libraryCount = frames.filter(isLibrary).length;
  const visible = showLibrary ? frames : frames.filter((f) => !isLibrary(f));
  const shown = visible.length ? visible : frames;
  const mapped = frames.some((f) => f.minified);
  // Open the code of the first frame that has it: usually where the error was thrown.
  const firstWithCode = shown.findIndex((f) => f.context);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">Most recent call first</p>
        {mapped && <Badge variant="secondary">Source mapped</Badge>}
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
          {shown.map((frame, i) => (
            <FrameRow key={i} frame={frame} defaultOpen={i === firstWithCode} />
          ))}
        </ol>
      )}
    </div>
  );
}

function Location({ frame }: { frame: { filename: string; lineno?: number; colno?: number } }) {
  return (
    <span className="break-all">
      {frame.filename}
      {frame.lineno !== undefined && (
        <span className="text-muted-foreground">
          :{frame.lineno}
          {frame.colno !== undefined && `:${frame.colno}`}
        </span>
      )}
    </span>
  );
}

function FrameRow({ frame, defaultOpen }: { frame: StackFrame; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const library = isLibrary(frame);
  const header = (
    <>
      <span className="font-semibold">{frame.function ?? "<anonymous>"}</span>
      <span className="text-muted-foreground">in</span>
      <Location frame={frame} />
    </>
  );

  if (!frame.context) {
    return (
      <li
        className={cn(
          "flex flex-wrap items-baseline gap-x-2 px-3 py-2",
          library && "text-muted-foreground",
        )}
      >
        {header}
      </li>
    );
  }

  const { pre, line, post } = frame.context;
  const first = (frame.lineno ?? 1) - pre.length;
  return (
    <li className={cn(library && "text-muted-foreground")}>
      <button
        type="button"
        className="flex w-full flex-wrap items-baseline gap-x-2 px-3 py-2 text-left hover:bg-muted/50"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRightIcon
          className={cn("size-3 shrink-0 self-center transition-transform", open && "rotate-90")}
        />
        {header}
      </button>
      {open && (
        <div className="border-t bg-muted/40">
          <pre className="overflow-x-auto py-2 leading-relaxed">
            {[...pre, line, ...post].map((code, i) => {
              const current = i === pre.length;
              return (
                <div
                  key={i}
                  className={cn("flex", current && "bg-destructive/15 font-semibold")}
                  aria-current={current ? "true" : undefined}
                >
                  <span className="w-12 shrink-0 pr-3 text-right text-muted-foreground select-none">
                    {first + i}
                  </span>
                  <code className="pr-4">{code || " "}</code>
                </div>
              );
            })}
          </pre>
          {frame.minified && (
            <p className="border-t px-3 py-1.5 text-muted-foreground">
              Minified: <Location frame={frame.minified} />
            </p>
          )}
        </div>
      )}
    </li>
  );
}
