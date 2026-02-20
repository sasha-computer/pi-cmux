# CLAUDE.md

## What this is

A pi extension that connects to cmux's Unix domain socket to provide context-aware notifications, sidebar status pills, and LLM-callable tools for browser automation and workspace control. Pi is a coding agent TUI; cmux is a Ghostty-based terminal multiplexer with built-in AI agent support.

## Project structure

```
extensions/
  index.ts           Extension entry point (hooks, tools, lifecycle)
  cmux-client.ts     Socket client (node:net, v2 JSON + v1 text protocol)
  notifications.ts   Notification logic (content extraction, summary building)
  status.ts          Sidebar status pills (model, state, thinking, tokens)
  tools.ts           LLM-callable tools (cmux_browser, cmux_workspace, cmux_notify)
package.json         Pi package manifest
TODO.md              Full roadmap with phases
cmux-guide.md        cmux API reference
```

## Key conventions

- No build step. Pi loads TypeScript directly via jiti.
- Graceful degradation everywhere. If cmux is unavailable, return null / do nothing. Never throw.
- The socket client maintains a single persistent connection with auto-reconnect.
- Request/response correlation uses UUID `id` fields (v2). V1 text commands use FIFO queue matching.
- Notifications target the specific surface via `CMUX_SURFACE_ID` env var.
- Status pills target the workspace via `CMUX_WORKSPACE_ID` env var.
- Tool output is truncated to 50KB/2000 lines (browser snapshots can be large).

## Testing

Load the extension locally:
```bash
pi -e ./extensions
```

Use `/reload` in pi to hot-reload after changes.

Test the socket manually:
```bash
echo '{"id":"1","method":"notification.create","params":{"title":"test","body":"hello"}}' | nc -U "$CMUX_SOCKET_PATH"
```

## cmux socket protocol

v2 is newline-delimited JSON over a Unix socket at `$CMUX_SOCKET_PATH`:

```json
{"id":"uuid","method":"notification.create_for_surface","params":{"surface_id":"...","title":"...","body":"..."}}
{"id":"uuid","ok":true,"result":{...}}
```

v1 is plain text commands (used for status pills):

```
set_status pi_model sonnet-4 --icon=brain --color=#8B5CF6 --tab=<workspace_id>
OK
```

See `cmux-guide.md` for the full API surface.

## Phase status

- [x] Phase 1: Context-aware notifications
- [x] Phase 2: Sidebar status pills
- [x] Phase 3: Custom tools (browser, workspace, notify)
- [x] Phase 4: Session management
- [x] Phase 5: Widget + footer
- [x] Phase 6: Polish + packaging
