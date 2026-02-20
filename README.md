# pi-cmux

A [pi](https://github.com/mariozechner/pi-coding-agent) extension that talks directly to the [cmux](https://github.com/manaflow-ai/cmux) socket API.

Replaces generic "Waiting for input" notifications with real context about what the agent did. No more guessing which session needs you.

## What it does

When pi finishes a task inside cmux, instead of a useless notification saying "Waiting for input", you get:

- **"Edited 3 files"** when the agent changed code
- **"Error: exit code 1 — cannot find module..."** when a build failed
- The actual last thing the agent said, truncated to fit

Notifications target the specific cmux surface, so you know exactly which workspace needs attention.

If you're not running inside cmux, the extension does nothing. No errors, no noise.

## Install

Add to your pi settings:

```json
{
  "packages": ["git:github.com/sasha-computer/pi-cmux"]
}
```

Or load locally during development:

```bash
pi -e ./extensions
```

## How it works

The extension connects to cmux's Unix domain socket (`$CMUX_SOCKET_PATH`) and speaks its v2 JSON protocol. On each agent run it tracks:

- Files edited and written
- Bash commands and their exit codes
- Error output from failed commands

When the agent finishes (`agent_end`), it builds a one-line summary and fires a targeted notification via `notification.create_for_surface`.

The socket client auto-reconnects if cmux restarts. If the socket is unreachable, every method returns `null` silently.

## Architecture

```
extensions/
  index.ts           Entry point — wires hooks, manages connection lifecycle
  cmux-client.ts     Persistent Unix socket client (v2 JSON protocol)
  notifications.ts   Hook handlers that fire contextual notifications
```

## Environment

The extension reads these env vars (injected by cmux into every child shell):

| Variable | Used for |
|---|---|
| `CMUX_SOCKET_PATH` | Socket connection (required) |
| `CMUX_SURFACE_ID` | Targeting notifications to the right surface |
| `PI_CMUX_DISABLE=1` | Force disable even inside cmux |
| `PI_CMUX_VERBOSE=1` | Log socket traffic to stderr |

## Roadmap

See [TODO.md](TODO.md) for the full plan. Phase 1 (context-aware notifications) is done. Next up:

- **Phase 2** — Sidebar status pills (model, agent state, token usage)
- **Phase 3** — LLM-callable tools (browser automation, workspace control)
- **Phase 4** — Session management integration
- **Phase 5** — Widget + footer integration
- **Phase 6** — Polish + packaging

## License

MIT
