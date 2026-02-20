# CLAUDE.md

## What this is

A pi extension that connects to cmux's Unix domain socket to send context-aware notifications. Pi is a coding agent TUI; cmux is a Ghostty-based terminal multiplexer with built-in AI agent support.

## Project structure

```
extensions/
  index.ts           Extension entry point (hooks + lifecycle)
  cmux-client.ts     Socket client (node:net, v2 JSON protocol)
  notifications.ts   Notification logic (content extraction, summary building)
package.json         Pi package manifest
TODO.md              Full roadmap with phases
cmux-guide.md        cmux API reference
```

## Key conventions

- No build step. Pi loads TypeScript directly via jiti.
- Graceful degradation everywhere. If cmux is unavailable, return null / do nothing. Never throw.
- The socket client maintains a single persistent connection with auto-reconnect.
- Request/response correlation uses UUID `id` fields.
- All notifications target the specific surface via `CMUX_SURFACE_ID` env var.

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

See `cmux-guide.md` for the full API surface.

## Phase status

- [x] Phase 1: Context-aware notifications
- [ ] Phase 2: Sidebar status pills
- [ ] Phase 3: Custom tools (browser, workspace, notify)
- [ ] Phase 4: Session management
- [ ] Phase 5: Widget + footer
- [ ] Phase 6: Polish + packaging
