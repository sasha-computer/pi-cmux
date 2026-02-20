# pi-cmux

A [pi](https://github.com/mariozechner/pi-coding-agent) extension that talks directly to the [cmux](https://github.com/manaflow-ai/cmux) socket API.

Replaces generic "Waiting for input" notifications with real context about what the agent did, shows agent state in the sidebar, and gives the LLM tools to drive the browser and control workspaces.

## What it does

**Context-aware notifications** -- when pi finishes a task inside cmux, instead of "Waiting for input", you get:
- **"Edited 3 files"** when the agent changed code
- **"Error: exit code 1 -- cannot find module..."** when a build failed
- The actual last thing the agent said, truncated to fit

**Sidebar status pills** -- at a glance in the cmux sidebar:
- Model name (e.g. `sonnet-4`)
- Agent state (`Running` / `Idle`)
- Thinking level (`high`, `medium`)
- Token usage (`45k/200k`, color-coded by usage)

**LLM tools** -- the agent can control cmux programmatically:
- `cmux_browser` -- open URLs, take accessibility snapshots, click, fill forms, evaluate JS, screenshot, navigate
- `cmux_workspace` -- list/create workspaces, split panes, focus surfaces, send text to other terminals
- `cmux_notify` -- send targeted notifications when the agent needs your attention

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

The extension connects to cmux's Unix domain socket (`$CMUX_SOCKET_PATH`) and speaks its v2 JSON protocol plus v1 text commands (for status pills).

**Notifications**: on each agent run it tracks files edited/written, bash exit codes, and error output. When the agent finishes (`agent_end`), it builds a one-line summary and fires a targeted notification via `notification.create_for_surface`.

**Status pills**: hooks into `session_start`, `model_select`, `agent_start`, `agent_end`, and `turn_end` to keep the sidebar current. All pills are cleared on `session_shutdown`.

**Tools**: three tools registered via `pi.registerTool()` that route actions to the appropriate v2 socket methods. Browser snapshots and large responses are truncated to 50KB/2000 lines.

The socket client auto-reconnects if cmux restarts. If the socket is unreachable, every method returns `null` silently.

## Architecture

```
extensions/
  index.ts           Entry point -- wires hooks, tools, manages connection lifecycle
  cmux-client.ts     Persistent Unix socket client (v2 JSON + v1 text protocol)
  notifications.ts   Hook handlers that fire contextual notifications
  status.ts          Sidebar status pill manager
  tools.ts           LLM-callable tools (browser, workspace, notify)
```

## Environment

The extension reads these env vars (injected by cmux into every child shell):

| Variable | Used for |
|---|---|
| `CMUX_SOCKET_PATH` | Socket connection (required) |
| `CMUX_WORKSPACE_ID` | Targeting status pills to the right workspace |
| `CMUX_SURFACE_ID` | Targeting notifications to the right surface |
| `PI_CMUX_DISABLE=1` | Force disable even inside cmux |
| `PI_CMUX_VERBOSE=1` | Log socket traffic to stderr |

## Roadmap

See [TODO.md](TODO.md) for the full plan.

- [x] **Phase 1** -- Context-aware notifications
- [x] **Phase 2** -- Sidebar status pills
- [x] **Phase 3** -- LLM-callable tools (browser, workspace, notify)
- [ ] **Phase 4** -- Session management integration
- [ ] **Phase 5** -- Widget + footer integration
- [ ] **Phase 6** -- Polish + packaging

## License

MIT
