import type { ErrorEvent } from "@mini-sentry/shared";

export interface InitOptions {
  dsn: string;
}

export type { ErrorEvent };

// Error capture and transport arrive in week 2.
export function init(options: InitOptions): InitOptions {
  return options;
}
