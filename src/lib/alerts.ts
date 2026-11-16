import "server-only";

import { after } from "next/server";

/** The same problem is reported at most once per this window, per server instance. */
const quietPeriodMs = 10 * 60 * 1000;
const maxRemembered = 200;
const alertTimeoutMs = 5_000;
const red = 0xf87171;

const lastSentAt = new Map<string, number>();

export type Problem = {
  /** Identifies the problem, so repeats are muted. Keep it free of user data. */
  key: string;
  title: string;
  detail?: string;
  /** Where it happened, like "POST /api/sessions". */
  where?: string;
};

/** Whether this problem was already reported recently. Remembers it if not. */
export function shouldSend(key: string, now: number = Date.now()): boolean {
  const last = lastSentAt.get(key);
  if (last !== undefined && now - last < quietPeriodMs) return false;
  if (lastSentAt.size >= maxRemembered) lastSentAt.clear();
  lastSentAt.set(key, now);
  return true;
}

/** The Discord message for a problem. */
export function discordMessage(problem: Problem, env: Record<string, string | undefined> = process.env) {
  const fields = [
    problem.where && { name: "Where", value: problem.where.slice(0, 200), inline: true },
    { name: "Environment", value: env.VERCEL_ENV ?? "local", inline: true },
    env.VERCEL_GIT_COMMIT_SHA && { name: "Commit", value: env.VERCEL_GIT_COMMIT_SHA.slice(0, 7), inline: true },
  ].filter(Boolean);
  return {
    username: "Pickify alerts",
    embeds: [
      {
        title: problem.title.slice(0, 250),
        description: problem.detail ? `\`\`\`\n${problem.detail.slice(0, 1500)}\n\`\`\`` : undefined,
        color: red,
        fields,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

async function post(webhookUrl: string, problem: Problem): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordMessage(problem)),
      signal: AbortSignal.timeout(alertTimeoutMs),
    });
    if (!response.ok) console.error(`[alerts] Discord answered ${response.status}`);
  } catch (error) {
    console.error("[alerts] couldn't reach Discord", error);
  }
}

/**
 * Sends an alert to the Discord channel in DISCORD_ALERT_WEBHOOK_URL, after the
 * response has gone out so it never slows anyone down. Does nothing when that
 * variable isn't set (set it in Production only), and mutes repeats of the
 * same problem for 10 minutes. Never throws.
 */
export function reportProblem(problem: Problem): void {
  const webhookUrl = process.env.DISCORD_ALERT_WEBHOOK_URL;
  if (!webhookUrl || !shouldSend(problem.key)) return;
  try {
    after(() => post(webhookUrl, problem));
  } catch {
    // Outside a request (scripts, tests): send without waiting.
    void post(webhookUrl, problem);
  }
}

/** A short description of a thrown value for an alert: its type, message and the top of its stack. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack?.split("\n").slice(1, 6).join("\n") ?? "";
    return `${error.name}: ${error.message}\n${stack}`.trim();
  }
  return String(error);
}
