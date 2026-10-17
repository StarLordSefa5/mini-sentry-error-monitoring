export type WebhookProvider = "discord" | "slack" | "generic";

export interface WebhookPolicy {
  /**
   * Accept any http(s) URL as a generic JSON webhook. Only for local development and tests:
   * the worker would POST to whatever address a user typed, including internal services.
   */
  allowAnyHost: boolean;
}

export type WebhookCheck = { ok: true; provider: WebhookProvider } | { ok: false; reason: string };

const DISCORD_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discord.com",
]);

/**
 * Only Discord and Slack webhook URLs are accepted by default. A free-form URL would let any user
 * make our servers send requests into our own network (SSRF), e.g. to Redis or a cloud metadata
 * endpoint.
 */
export function checkWebhookUrl(raw: string, policy: WebhookPolicy): WebhookCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (url.username || url.password)
    return { ok: false, reason: "URL must not contain credentials." };

  if (url.protocol === "https:") {
    if (DISCORD_HOSTS.has(url.hostname) && url.pathname.startsWith("/api/webhooks/")) {
      return { ok: true, provider: "discord" };
    }
    if (url.hostname === "hooks.slack.com" && url.pathname.startsWith("/services/")) {
      return { ok: true, provider: "slack" };
    }
  }
  if (policy.allowAnyHost && (url.protocol === "https:" || url.protocol === "http:")) {
    return { ok: true, provider: "generic" };
  }
  return { ok: false, reason: "Use a Discord or Slack incoming webhook URL (https)." };
}

export interface AlertMessage {
  kind: "new_issue" | "regression" | "test";
  projectName: string;
  issue: { type: string; message: string; culprit: string | null; count: number };
  /** Link to the issue in the dashboard. */
  url: string;
  release?: string | null;
  environment?: string | null;
}

const TITLES: Record<AlertMessage["kind"], string> = {
  new_issue: "New issue",
  regression: "Regression",
  test: "Test notification",
};

// Discord embed colors: red for new, orange for regressions, grey for tests.
const COLORS: Record<AlertMessage["kind"], number> = {
  new_issue: 0xe5484d,
  regression: 0xf76b15,
  test: 0x8b8d98,
};

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function headline(msg: AlertMessage): string {
  return `${TITLES[msg.kind]}: ${msg.issue.type}`;
}

function details(msg: AlertMessage): [string, string][] {
  return [
    ["Project", msg.projectName],
    ["Location", msg.issue.culprit ?? ""],
    ["Release", msg.release ?? ""],
    ["Environment", msg.environment ?? ""],
  ].filter((pair): pair is [string, string] => Boolean(pair[1]));
}

/** Request body in the format the provider expects. Lengths are capped to the providers' limits. */
export function buildPayload(provider: WebhookProvider, msg: AlertMessage): unknown {
  if (provider === "discord") {
    return {
      username: "Mini Sentry",
      embeds: [
        {
          title: truncate(headline(msg), 256),
          description: truncate(msg.issue.message || "(no message)", 2000),
          url: msg.url,
          color: COLORS[msg.kind],
          fields: details(msg).map(([name, value]) => ({
            name,
            value: truncate(value, 1024),
            inline: true,
          })),
        },
      ],
    };
  }

  if (provider === "slack") {
    // Slack mrkdwn treats &, < and > as control characters.
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const context = details(msg)
      .map(([name, value]) => `*${name}:* ${escape(value)}`)
      .join("  ·  ");
    return {
      text: truncate(`${headline(msg)} – ${msg.issue.message}`, 3000),
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: truncate(
              `*<${msg.url}|${escape(headline(msg))}>*\n${escape(msg.issue.message)}`,
              3000,
            ),
          },
        },
        ...(context
          ? [{ type: "context", elements: [{ type: "mrkdwn", text: truncate(context, 3000) }] }]
          : []),
      ],
    };
  }

  return { event: msg.kind, ...msg };
}

export class WebhookError extends Error {
  constructor(
    message: string,
    /** False for errors a retry cannot fix, such as a deleted webhook (404). */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Posts the alert. Throws WebhookError on rejection, timeout or network failure. */
export async function sendWebhook(
  rawUrl: string,
  msg: AlertMessage,
  policy: WebhookPolicy,
  timeoutMs = 5000,
): Promise<void> {
  // Checked again at send time: the stored URL may predate a stricter policy.
  const check = checkWebhookUrl(rawUrl, policy);
  if (!check.ok) throw new WebhookError(check.reason, false);

  let res: Response;
  try {
    res = await fetch(rawUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload(check.provider, msg)),
      // A redirect could point anywhere, including internal addresses.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new WebhookError(`Webhook request failed: ${(err as Error).message}`, true);
  }

  if (!res.ok) {
    // 429 and 5xx are worth retrying; other 4xx mean the webhook is gone or the payload is wrong.
    const retryable = res.status === 429 || res.status >= 500;
    throw new WebhookError(`Webhook answered HTTP ${res.status}`, retryable);
  }
}
