# pi-cmux: Native cmux Extension for Pi

> A pi extension that talks directly to the cmux socket API, giving the agent
> rich context-aware notifications, workspace control, and browser automation
> without shelling out to the `cmux` CLI.

## Why

Right now the only integration between pi and cmux is a dumb shell hook in
`~/.claude/settings.json` that fires `cmux notify --title 'Claude Code' --body
'Waiting for input'`. Every notification says the same thing. The agent has no
idea which cmux workspace it lives in, cannot control splits, cannot drive the
browser, and cannot set sidebar status pills.

cmux already exposes everything we need:

- **Unix socket** at `$CMUX_SOCKET_PATH` (default `/tmp/cmux.sock`) speaking
  newline-delimited JSON (v2 protocol)
- **Environment variables** injected into every child shell:
  `CMUX_SOCKET_PATH`, `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`, `CMUX_TAB_ID`,
  `CMUX_PANEL_ID`
- **Sidebar status pills** via `set_status <key> <value> --icon=X --color=#hex
  --tab=<workspace_id>` (v1 command)
- **`system.identify`** method that returns the full focused context (window,
  workspace, pane, surface)
- **`notification.create_for_surface`** for surface-targeted notifications
- **Browser automation** (`browser.snapshot`, `browser.eval`, `browser.click`,
  `browser.fill`, etc.) on any browser surface
- **`surface.trigger_flash`** to visually highlight a surface

A pi extension can hook into every lifecycle event and fire precise, contextual
notifications and status updates over the socket. No more "Waiting for input".

---

## Architecture

```
pi extension (TypeScript, loaded via jiti)
  |
  ├── cmux-client.ts        Socket client (node:net, Unix domain socket)
  |                          Sends v2 JSON requests, parses responses.
  |                          Falls back gracefully when cmux is not running.
  |
  ├── notifications.ts       Hook handlers that fire cmux notifications
  |                          with real context (what tool ran, what file
  |                          changed, did the build pass/fail).
  |
  ├── status.ts              Sidebar status pill manager. Sets/clears
  |                          status entries on the workspace sidebar
  |                          (model name, thinking level, token usage,
  |                          agent state).
  |
  ├── tools.ts               Custom tools exposed to the LLM:
  |                          cmux_browser, cmux_workspace, cmux_notify.
  |
  └── index.ts               Extension entry point. Wires hooks + tools.
```

### Socket client design

```typescript
// Persistent connection with auto-reconnect.
// All methods return | null when cmux is unavailable.
class CmuxClient {
  private socket: net.Socket | null;
  private pending: Map<string, { resolve, reject, timer }>;

  connect(): Promise<boolean>;
  request(method: string, params?: Record<string, any>): Promise<any | null>;
  v1(command: string): Promise<string | null>;  // for set_status, legacy
  isConnected(): boolean;
  close(): void;
}
```

Key design decisions:
- **Single persistent connection** per session. The socket is cheap.
- **Request/response correlation** via `id` field (UUID per request).
- **Timeout per request** (5s default, configurable). cmux responds fast.
- **Graceful degradation**: if `CMUX_SOCKET_PATH` is unset or the socket is
  unreachable, every method returns null silently. The extension becomes a
  no-op. No errors, no noise. Works identically in Ghostty, iTerm, SSH.
- **Auto-reconnect**: if the socket drops (cmux restart), reconnect on next
  request.

---

## Phase 1: Context-Aware Notifications ✅

**Goal**: Replace generic "Waiting for input" with notifications that tell you
what happened and what the agent needs.

**Status**: Done. Shipped in initial commit.

### Hooks to wire

| pi hook | cmux action | Notification content |
|---------|-------------|---------------------|
| `agent_end` | `notification.create_for_surface` | "Done: <last assistant summary>" or "Done: edited 3 files" |
| `tool_result` (bash, error) | `notification.create_for_surface` | "Build failed: exit 1" / "Tests: 3 passed, 1 failed" |
| `tool_result` (bash, success with port) | `notification.create_for_surface` | "Server started on :3000" |
| `tool_result` (write/edit) | sidebar status update | "Edited: src/app.tsx" (transient) |

### Smart idle detection

Don't fire a notification the instant the agent stops. Instead:

1. On `agent_end`, check if the agent produced tool calls in this turn.
2. If yes: summarize what happened (files edited, commands run, errors).
3. If the user's cmux surface is focused (`system.identify` -> check
   `focused.surface_id === our surface`), skip the notification entirely.
   cmux already does this server-side, but checking client-side avoids
   the socket round-trip for the common case.

### Notification content extraction

From `agent_end` event, walk `event.messages` backwards to find:
- Last assistant text (truncate to 120 chars)
- Tool results: count files written/edited, bash exit codes, error messages
- Build a one-line summary: "Edited 3 files, ran tests (passed)"

From `tool_result` events (streamed):
- If bash tool and `exitCode !== 0`: immediate notification with error output
  (first 2 lines of stderr)
- If bash tool output contains "error:", "FAIL", "Error:" patterns: notify

---

## Phase 2: Sidebar Status Pills ✅

**Goal**: The cmux sidebar shows per-workspace status pills. Use them to
display agent state at a glance.

**Status**: Done. V1 command support added to CmuxClient (FIFO queue for
non-JSON responses). Status pills for model, state, thinking level, and
token usage wired to lifecycle hooks. All pills cleared on session shutdown.

### Status entries to maintain

| Key | When set | Value | Icon | Color |
|-----|----------|-------|------|-------|
| `pi_model` | `session_start`, `model_select` | "sonnet-4" | `brain` | `#8B5CF6` |
| `pi_state` | `agent_start` / `agent_end` | "Running" / "Idle" | `bolt.fill` / `checkmark.circle` | `#4C8DFF` / `#22C55E` |
| `pi_thinking` | `before_agent_start` (if reasoning) | "high" | `sparkles` | `#F59E0B` |
| `pi_tokens` | `turn_end` | "45k/200k" | `number` | `#6B7280` |

### Implementation

```typescript
// v1 socket command (v2 doesn't expose set_status yet)
await client.v1(`set_status pi_model ${shortName} --icon=brain --color=#8B5CF6 --tab=${workspaceId}`);
```

Clear all pi status entries on `session_shutdown`:
```typescript
for (const key of ["pi_model", "pi_state", "pi_thinking", "pi_tokens"]) {
  await client.v1(`clear_status ${key} --tab=${workspaceId}`);
}
```

---

## Phase 3: Custom Tools for the LLM ✅

**Goal**: Let the agent control cmux programmatically -- open browser splits,
create workspaces, navigate, snapshot pages.

**Status**: Done. Three tools registered: `cmux_browser` (16 actions covering
full browser automation), `cmux_workspace` (9 actions for workspace/surface
control), and `cmux_notify` (surface-targeted notifications). All tools
gracefully degrade when cmux is unavailable. Large responses (snapshots)
truncated to 50KB/2000 lines.

### Tool: `cmux_browser`

```typescript
pi.registerTool({
  name: "cmux_browser",
  description: "Control the cmux in-app browser. Open URLs, take snapshots, click elements, fill forms.",
  parameters: Type.Object({
    action: StringEnum([
      "open", "navigate", "snapshot", "click", "fill",
      "eval", "screenshot", "get_text", "get_url", "wait"
    ] as const),
    url: Type.Optional(Type.String()),
    selector: Type.Optional(Type.String()),
    text: Type.Optional(Type.String()),
    code: Type.Optional(Type.String()),
    surface_id: Type.Optional(Type.String()),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Route to appropriate v2 method
    switch (params.action) {
      case "open":
        return client.request("browser.open_split", { url: params.url });
      case "snapshot":
        return client.request("browser.snapshot", { surface_id: params.surface_id });
      case "click":
        return client.request("browser.click", { selector: params.selector });
      // ...
    }
  }
});
```

The LLM can then do things like:
1. "Open localhost:3000 in the browser" -> `cmux_browser open`
2. "What does the page show?" -> `cmux_browser snapshot` (returns accessibility tree)
3. "Click the submit button" -> `cmux_browser click`
4. "Fill in the search box" -> `cmux_browser fill`

### Tool: `cmux_workspace`

```typescript
pi.registerTool({
  name: "cmux_workspace",
  description: "Control cmux workspaces and surfaces. List, create, split, focus, flash.",
  parameters: Type.Object({
    action: StringEnum([
      "list", "create", "split", "focus", "flash",
      "identify", "send_text", "close"
    ] as const),
    // ...
  }),
});
```

### Tool: `cmux_notify`

```typescript
pi.registerTool({
  name: "cmux_notify",
  description: "Send a notification to the user via cmux. Use when you need explicit user attention.",
  parameters: Type.Object({
    title: Type.String(),
    subtitle: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
  }),
});
```

---

## Phase 4: Session Management Integration ✅

**Goal**: Wire into cmux's `claude-hook` session tracking so the sidebar shows
rich context even across pi session switches.

**Status**: Done. Session start sets initial sidebar status and registers with
cmux session tracking. Session shutdown clears all status pills and sends a
final summary notification.

### On `session_start`

```typescript
pi.on("session_start", async (_event, ctx) => {
  if (!client.isConnected()) return;

  const workspaceId = process.env.CMUX_WORKSPACE_ID;
  const surfaceId = process.env.CMUX_SURFACE_ID;

  // Set initial sidebar status
  await setModelStatus(ctx);
  await setAgentState("Idle");

  // Register with cmux's session tracking
  // (similar to what `cmux claude-hook session-start` does)
});
```

### On `session_shutdown`

```typescript
pi.on("session_shutdown", async (_event, ctx) => {
  // Clear all status pills
  await clearAllStatus();

  // If there were meaningful results, send a final "Completed" notification
  // (similar to `cmux claude-hook stop` which reads transcript for summary)
});
```

---

## Phase 5: Widget + Footer Integration ✅

**Goal**: Show cmux connection state and workspace info inside pi's own TUI.

**Status**: Done. Footer shows "cmux" when connected. Widget displays unread
notification count from other workspaces.

### Footer status

```typescript
ctx.ui.setStatus("cmux", cmuxConnected ? "cmux" : undefined);
```

Shows "cmux" in pi's footer when connected. Disappears when not in cmux.

### Widget (optional)

Show the current workspace's notification count above the editor:

```typescript
const unread = notifications.filter(n => !n.is_read).length;
if (unread > 0) {
  ctx.ui.setWidget("cmux-unread", [`${unread} unread notification${unread > 1 ? "s" : ""} in other workspaces`]);
}
```

---

## Phase 6: Polish + Packaging ✅

### Package structure

```
pi-cmux/
  package.json          # pi package with "keywords": ["pi-package"]
  extensions/
    index.ts            # Entry point
    cmux-client.ts      # Socket client
    notifications.ts    # Notification hooks
    status.ts           # Sidebar status management
    tools.ts            # LLM-callable tools
```

### Installation

```bash
pi install git:github.com/<user>/pi-cmux
```

Or local development:

```bash
pi -e ./pi-cmux/extensions
```

### Configuration

Extension reads from env vars only. No configuration needed. If `CMUX_SOCKET_PATH`
exists and the socket is reachable, the extension activates. Otherwise, it's a
silent no-op.

Optional env var overrides:
- `PI_CMUX_DISABLE=1` -- force disable even inside cmux
- `PI_CMUX_VERBOSE=1` -- log socket traffic to stderr (debug)

---

## Implementation Order

1. **Socket client** (`cmux-client.ts`) -- the foundation. Test with
   `cmux ping` equivalent. ~50 lines.

2. **Status pills** (`status.ts`) -- most visible quick win. Wire
   `session_start`, `model_select`, `agent_start`, `agent_end`, `turn_end`.
   Immediate sidebar visibility. ~80 lines.

3. **Smart notifications** (`notifications.ts`) -- the main value prop.
   Wire `agent_end` and `tool_result`. Context extraction from messages.
   ~120 lines.

4. **Browser tool** (`tools.ts`) -- highest leverage for agent workflows.
   Single tool with action enum routing to v2 browser methods. ~100 lines.

5. **Workspace tool** -- topology control. Lower priority but enables
   multi-agent orchestration patterns. ~80 lines.

6. **Widget/footer** -- polish. Tiny. ~20 lines.

7. **Package + README + publish** -- ship it.

Total estimated: ~450 lines of TypeScript. One afternoon.

---

## Open Questions

- [ ] Should the browser tool return raw accessibility tree snapshots or
      should we summarize/truncate them? Snapshots can be huge on complex
      pages. Probably truncate to 50KB like other tools.

- [ ] Should we expose `surface.send_text` / `surface.send_key` to the LLM?
      This lets the agent type into other terminal panes, which is powerful
      for multi-agent coordination but also risky. Gate behind a confirm?

- [ ] cmux's `set_status` is a v1 command. If cmux adds v2 equivalents,
      switch to those. For now, v1 works fine.

- [ ] Should we auto-open the browser when the agent starts a dev server?
      Could detect port output in `tool_result` and fire
      `browser.open_split` with the URL. Feels magical but could be
      annoying. Maybe gate behind a `/cmux-auto-browser` toggle.

---

## References

- cmux source: https://github.com/manaflow-ai/cmux
- cmux v2 API: newline-delimited JSON over Unix socket
- cmux env vars: `CMUX_SOCKET_PATH`, `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`,
  `CMUX_TAB_ID`, `CMUX_PANEL_ID`
- cmux status pills: `set_status <key> <value> --icon=X --color=#hex --tab=X`
- cmux `claude-hook`: `cmux claude-hook <session-start|stop|notification>`
  -- reads JSON from stdin, manages session state in
  `~/.cmuxterm/claude-hook-sessions.json`
- cmux browser API: full agent-browser port (P0+P1 complete) --
  `browser.snapshot`, `browser.eval`, `browser.click`, `browser.fill`,
  `browser.wait`, `browser.find.*`, etc.
- pi extension docs: `~/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- pi hooks: `session_start`, `agent_start`, `agent_end`, `turn_end`,
  `tool_result`, `model_select`, `session_shutdown`
