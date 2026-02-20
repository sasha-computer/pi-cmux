# AGENTS.md

Instructions for AI agents working on this codebase.

## Context

This is a pi extension (TypeScript, no build step) that integrates with cmux's Unix domain socket API. Read `CLAUDE.md` for project structure and conventions. Read `cmux-guide.md` for the full cmux API reference. Read `TODO.md` for the roadmap.

## Rules

1. **Never throw errors when cmux is unavailable.** Every socket call must return null gracefully. The extension runs in terminals that aren't cmux too.

2. **No npm dependencies.** The socket client uses `node:net` and `node:crypto` from the standard library. Pi extensions load via jiti with no build step. Keep it that way.

3. **Imports from pi packages only.** Types come from `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, and `@sinclair/typebox`. These are peer dependencies provided by the pi runtime.

4. **Use `StringEnum` not `Type.Union(Type.Literal(...))` for tool parameter enums.** Google's API breaks on the latter.

5. **Test with `pi -e ./extensions`** and `/reload` for hot-reloading. No test framework needed for now.

6. **Truncate tool output to 50KB.** If exposing cmux data to the LLM (browser snapshots, accessibility trees), use `truncateTail` from pi-coding-agent.

7. **Atomic commits.** One logical change per commit. Don't bundle unrelated work.

## Socket protocol quick reference

v2 (JSON -- used for requests, browser, workspace, notifications):
```
Send:    {"id":"uuid","method":"<method>","params":{...}}\n
Receive: {"id":"uuid","ok":true,"result":{...}}\n
Error:   {"id":"uuid","ok":false,"error":{"code":"...","message":"..."}}\n
```

v1 (plain text -- used for status pills):
```
Send:    set_status <key> <value> --icon=<icon> --color=<hex> --tab=<workspace_id>\n
Receive: OK\n
```

Key v2 methods: `notification.create`, `notification.create_for_surface`, `system.identify`, `surface.trigger_flash`, `surface.split`, `surface.send_text`, `browser.open_split`, `browser.snapshot`, `browser.click`, `browser.fill`, `browser.eval`, `browser.navigate`.

## File responsibilities

| File | What it does | When to edit |
|---|---|---|
| `cmux-client.ts` | Socket connection, v2 JSON + v1 text send/receive | Adding new protocol features |
| `notifications.ts` | Hook handlers, content extraction, summary building | Changing notification behavior |
| `status.ts` | Sidebar status pills (model, state, thinking, tokens) | Changing sidebar display |
| `tools.ts` | LLM-callable tools (browser, workspace, notify) | Adding/changing agent tools |
| `index.ts` | Wires hooks + tools, manages connection lifecycle | Adding new phases/features |
