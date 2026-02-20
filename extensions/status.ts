/**
 * Sidebar status pill manager for cmux.
 *
 * Displays agent state at a glance in the cmux workspace sidebar:
 * model name, running/idle state, thinking level, and token usage.
 *
 * Uses v1 raw text commands over the socket (v2 doesn't expose set_status yet).
 */

import type { ExtensionAPI, ExtensionContext, ContextUsage } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import type { CmuxClient } from "./cmux-client.js";

const STATUS_KEYS = ["pi_model", "pi_state", "pi_thinking", "pi_tokens"] as const;

/** Format a model name for the sidebar pill (short, readable). */
function shortModelName(model: Model<any>): string {
  // e.g. "claude-sonnet-4-20250514" -> "sonnet-4"
  //      "gpt-4o-2024-08-06" -> "gpt-4o"
  const id = model.id;

  // Strip date suffixes like -20250514 or -2024-08-06
  const stripped = id.replace(/-\d{4,}(-\d{2}(-\d{2})?)?$/, "");

  // For Anthropic models, drop the "claude-" prefix
  if (model.provider === "anthropic") {
    return stripped.replace(/^claude-/, "");
  }

  return stripped;
}

/** Format token count: 1234 -> "1.2k", 123456 -> "123k" */
function formatTokens(n: number | null): string {
  if (n === null) return "?";
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

export function wireStatus(pi: ExtensionAPI, client: CmuxClient): void {
  const workspaceId = process.env.CMUX_WORKSPACE_ID;

  async function setStatus(
    key: string,
    value: string,
    icon: string,
    color: string,
  ): Promise<void> {
    const tab = workspaceId ? ` --tab=${workspaceId}` : "";
    await client.v1(`set_status ${key} ${value} --icon=${icon} --color=${color}${tab}`);
  }

  async function clearStatus(key: string): Promise<void> {
    const tab = workspaceId ? ` --tab=${workspaceId}` : "";
    await client.v1(`clear_status ${key}${tab}`);
  }

  async function clearAllStatus(): Promise<void> {
    for (const key of STATUS_KEYS) {
      await clearStatus(key);
    }
  }

  // Set model pill on session start and model change
  async function setModelPill(model: Model<any> | undefined): Promise<void> {
    if (!model) return;
    await setStatus("pi_model", shortModelName(model), "brain", "#8B5CF6");
  }

  // Set thinking level pill
  async function setThinkingPill(): Promise<void> {
    const level = pi.getThinkingLevel();
    if (level === "off") {
      await clearStatus("pi_thinking");
    } else {
      await setStatus("pi_thinking", level, "sparkles", "#F59E0B");
    }
  }

  // Set token usage pill
  async function setTokensPill(usage: ContextUsage | undefined): Promise<void> {
    if (!usage || usage.tokens === null) {
      await clearStatus("pi_tokens");
      return;
    }
    const label = `${formatTokens(usage.tokens)}/${formatTokens(usage.contextWindow)}`;
    // Color shifts from gray -> amber -> red based on usage
    let color = "#6B7280"; // gray
    if (usage.percent !== null) {
      if (usage.percent > 80) color = "#EF4444"; // red
      else if (usage.percent > 50) color = "#F59E0B"; // amber
    }
    await setStatus("pi_tokens", label, "number", color);
  }

  // --- Hook wiring ---

  pi.on("session_start", async (_event, ctx) => {
    if (!client.isConnected()) return;
    await setModelPill(ctx.model);
    await setThinkingPill();
    await setStatus("pi_state", "Idle", "checkmark.circle", "#22C55E");
  });

  pi.on("model_select", async (event, _ctx) => {
    if (!client.isConnected()) return;
    await setModelPill(event.model);
    // Thinking level may have changed with the model
    await setThinkingPill();
  });

  pi.on("agent_start", async () => {
    if (!client.isConnected()) return;
    await setStatus("pi_state", "Running", "bolt.fill", "#4C8DFF");
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!client.isConnected()) return;
    await setStatus("pi_state", "Idle", "checkmark.circle", "#22C55E");
    await setTokensPill(ctx.getContextUsage());
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!client.isConnected()) return;
    await setTokensPill(ctx.getContextUsage());
  });

  pi.on("session_shutdown", async () => {
    if (!client.isConnected()) return;
    await clearAllStatus();
  });
}
