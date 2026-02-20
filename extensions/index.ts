/**
 * pi-cmux: Native cmux extension for pi.
 *
 * Phase 1: Context-aware notifications via the cmux socket API.
 * Replaces generic "Waiting for input" with real context about
 * what the agent did and what it needs.
 *
 * Gracefully degrades: if not running inside cmux, the extension
 * is a silent no-op.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CmuxClient } from "./cmux-client.js";
import { wireNotifications } from "./notifications.js";

export default function (pi: ExtensionAPI) {
  const client = new CmuxClient();

  // Skip everything if cmux is not available
  if (!client.available) return;

  pi.on("session_start", async (_event, ctx) => {
    const connected = await client.connect();
    if (connected && ctx.hasUI) {
      ctx.ui.setStatus("cmux", "cmux");
    }
  });

  // Wire context-aware notifications
  wireNotifications(pi, client);

  // Clean up on shutdown
  pi.on("session_shutdown", async () => {
    client.close();
  });
}
