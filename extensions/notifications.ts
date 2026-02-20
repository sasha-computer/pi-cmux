/**
 * Context-aware notifications via cmux.
 *
 * Replaces generic "Waiting for input" with notifications that tell you
 * what happened and what the agent needs.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage, Message, TextContent } from "@mariozechner/pi-ai";
import { isBashToolResult } from "@mariozechner/pi-coding-agent";
import type { CmuxClient } from "./cmux-client.js";

interface TurnStats {
  filesEdited: string[];
  filesWritten: string[];
  bashCommands: number;
  bashErrors: number;
  lastError: string | null;
}

// Module-level turn tracking (reset each agent run)
let turnStats: TurnStats = freshStats();

function freshStats(): TurnStats {
  return {
    filesEdited: [],
    filesWritten: [],
    bashCommands: 0,
    bashErrors: 0,
    lastError: null,
  };
}

/**
 * Send a notification to the current surface via cmux.
 * Skips if the surface is already focused (cmux handles this server-side too,
 * but we avoid the round-trip).
 */
async function notify(
  client: CmuxClient,
  title: string,
  body?: string,
  subtitle?: string,
): Promise<void> {
  const surfaceId = process.env.CMUX_SURFACE_ID;
  if (!surfaceId) {
    // No surface ID -- fall back to untargeted notification
    await client.request("notification.create", {
      title,
      body: body ?? "",
      subtitle: subtitle ?? "",
    });
    return;
  }

  await client.request("notification.create_for_surface", {
    surface_id: surfaceId,
    title,
    body: body ?? "",
    subtitle: subtitle ?? "",
  });
}

/** Build a one-line summary from turn stats. */
function buildSummary(stats: TurnStats): string {
  const parts: string[] = [];

  const totalFiles = new Set([...stats.filesEdited, ...stats.filesWritten]).size;
  if (totalFiles > 0) {
    parts.push(`${totalFiles} file${totalFiles > 1 ? "s" : ""}`);
  }

  if (stats.bashCommands > 0) {
    if (stats.bashErrors > 0) {
      parts.push(`${stats.bashErrors} error${stats.bashErrors > 1 ? "s" : ""}`);
    }
  }

  if (parts.length === 0) return "Done";
  return parts.join(", ");
}

/** Extract the last assistant text from messages (truncated). */
function lastAssistantText(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      const textParts = (msg as AssistantMessage).content.filter(
        (c): c is TextContent => c.type === "text",
      );
      if (textParts.length > 0) {
        const text = textParts.map((t) => t.text).join(" ").trim();
        if (text.length > 120) return text.slice(0, 117) + "...";
        return text;
      }
    }
  }
  return null;
}

export function wireNotifications(pi: ExtensionAPI, client: CmuxClient): void {
  // Reset stats at the start of each agent run
  pi.on("agent_start", async () => {
    turnStats = freshStats();
  });

  // Track file edits/writes
  pi.on("tool_result", async (event) => {
    if (event.toolName === "edit") {
      const path = (event.input as any)?.path;
      if (path) turnStats.filesEdited.push(path);
    } else if (event.toolName === "write") {
      const path = (event.input as any)?.path;
      if (path) turnStats.filesWritten.push(path);
    } else if (isBashToolResult(event)) {
      turnStats.bashCommands++;
      if (event.isError) {
        turnStats.bashErrors++;
        // Extract first meaningful line from error content
        const errorText = event.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        const firstLine = errorText.split("\n").find((l) => l.trim());
        if (firstLine) {
          turnStats.lastError =
            firstLine.length > 100 ? firstLine.slice(0, 97) + "..." : firstLine;
        }
      }
    }
  });

  // Fire notification when the agent finishes
  pi.on("agent_end", async (event) => {
    if (!client.isConnected()) return;

    const summary = buildSummary(turnStats);
    const assistantText = lastAssistantText(event.messages as Message[]);

    // Build notification
    const title = "pi";
    let body: string;

    if (turnStats.lastError) {
      body = `Error: ${turnStats.lastError}`;
    } else if (assistantText) {
      body = assistantText;
    } else {
      body = summary;
    }

    await notify(client, title, body, summary !== "Done" ? summary : undefined);
  });
}
