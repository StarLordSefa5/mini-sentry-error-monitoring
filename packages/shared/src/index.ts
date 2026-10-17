export type IssueStatus = "unresolved" | "resolved" | "ignored";

export interface StackFrame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
}

/** A single error occurrence as sent by the SDK. */
export interface ErrorEvent {
  eventId: string;
  timestamp: string;
  type: string;
  message: string;
  frames: StackFrame[];
  url?: string;
  userAgent?: string;
}

/** A group of events that share the same fingerprint. */
export interface Issue {
  id: string;
  projectId: string;
  fingerprint: string;
  title: string;
  status: IssueStatus;
  count: number;
  firstSeen: string;
  lastSeen: string;
}
