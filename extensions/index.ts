/**
 * pi-cmux: Native cmux extension for pi.
 *
 * Phase 1: Context-aware notifications via the cmux socket API.
 * Phase 2: Sidebar status pills (model, state, thinking, tokens).
 * Phase 3: Custom tools for the LLM (browser, workspace, notify).
 *
 * Gracefully degrades: if not running inside cmux, the extension
 * is a silent no-op.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CmuxClient } from "./cmux-client.js";
import { wireNotifications } from "./notifications.js";
import { wireStatus } from "./status.js";
import { wireTools } from "./tools.js";

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

  // Wire sidebar status pills
  wireStatus(pi, client);

  // Wire custom tools (browser, workspace, notify)
  wireTools(pi, client);

  // Clean up on shutdown
  pi.on("session_shutdown", async () => {
    client.close();
  });
}
