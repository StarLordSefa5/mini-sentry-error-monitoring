import type { PrismaClient } from "@mini-sentry/db";
import { sendWebhook, WebhookError, type WebhookPolicy } from "@mini-sentry/notify";
import type { AlertJobData } from "@mini-sentry/shared";
import { UnrecoverableError } from "bullmq";

export type AlertResult = "sent" | "no_webhook" | "issue_gone";

export interface AlertDeps {
  prisma: PrismaClient;
  dashboardUrl: string;
  policy: WebhookPolicy;
}

/** Sends one new-issue or regression alert to the project's webhook. */
export async function deliverAlert(deps: AlertDeps, job: AlertJobData): Promise<AlertResult> {
  const issue = await deps.prisma.issue.findFirst({
    where: { id: job.issueId, projectId: job.projectId },
    select: {
      type: true,
      message: true,
      culprit: true,
      count: true,
      project: { select: { name: true, alertWebhookUrl: true } },
    },
  });
  if (!issue) return "issue_gone";
  if (!issue.project.alertWebhookUrl) return "no_webhook";

  const event = await deps.prisma.event.findUnique({
    where: { eventId: job.eventId },
    select: { release: true, environment: true },
  });

  try {
    await sendWebhook(
      issue.project.alertWebhookUrl,
      {
        kind: job.kind,
        projectName: issue.project.name,
        issue: {
          type: issue.type,
          message: issue.message,
          culprit: issue.culprit,
          count: issue.count,
        },
        url: `${deps.dashboardUrl}/projects/${job.projectId}/issues/${job.issueId}`,
        release: event?.release,
        environment: event?.environment,
      },
      deps.policy,
    );
  } catch (err) {
    // A deleted webhook (404) or a URL the policy refuses will not fix itself: stop retrying.
    if (err instanceof WebhookError && !err.retryable) throw new UnrecoverableError(err.message);
    throw err;
  }
  return "sent";
}
