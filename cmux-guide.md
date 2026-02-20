# cmux guide

A Ghostty-based macOS terminal with vertical tabs and notifications for AI coding agents.

- **Repo:** https://github.com/manaflow-ai/cmux
- **License:** AGPL-3.0 (fully open source)
- **Built with:** Swift + AppKit, powered by libghostty
- **Reads your existing** `~/.config/ghostty/config` — same fonts, themes, colors, zero reconfiguration

---

## The problem it solves

Running multiple Claude Code (or Codex, Gemini CLI, Amp, OpenCode) sessions in parallel across Ghostty split panes. macOS notifications have zero context — every one says "Claude is waiting for your input" — and with enough tabs open you can't tell which session needs you. cmux fixes this.

---

## Install

```bash
brew tap manaflow-ai/cmux
brew install --cask cmux
```

Auto-updates via Sparkle — install once, never think about it again. Nightly builds also available as a separate app (runs alongside stable).

---

## Features

### Notification rings

When an AI agent needs your input, its pane gets a **blue ring** and its sidebar tab lights up. `Cmd+Shift+U` jumps straight to the most recent unread across all sessions.

### Sidebar with real context per workspace

Each vertical tab in the sidebar shows:
- Git branch
- Working directory
- Listening ports
- Latest notification text from that agent

No more squinting at tab titles.

### Notification panel

`Cmd+I` opens a panel showing all pending notifications across every workspace. Jump to the most recent unread from anywhere.

### In-app browser

`Cmd+Shift+L` splits a WKWebView browser pane alongside your terminal. The browser has a scriptable API ported from Vercel's `agent-browser` — agents can snapshot the accessibility tree, click, fill forms, evaluate JS, take screenshots, and more. Claude Code can interact with your running dev server directly without a separate browser automation setup.

### Vertical + horizontal splits

Split right: `Cmd+D`
Split down: `Cmd+Shift+D`
Navigate between panes: `Option+Cmd+Arrow`

### Native macOS app

Not Electron. Not Tauri. Swift + AppKit — fast startup, low memory, GPU-accelerated terminal rendering via libghostty.

---

## CLI + Notification Integration

### Install check + notify

```bash
# Send a notification if cmux is running, fall back to macOS otherwise
command -v cmux &>/dev/null && cmux notify --title "Done" --body "Task complete" || osascript -e 'display notification "Task complete" with title "Done"'
```

### CLI commands

```bash
cmux notify --title "Title" --subtitle "Subtitle" --body "Body text"
cmux notify --title "Done" --tab 0 --panel 1   # target specific tab/panel
cmux list-notifications
cmux clear-notifications
cmux ping
```

---

## Claude Code hook integration

Add this to `~/.claude/settings.json` to wire cmux notifications into Claude Code:

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "command -v cmux &>/dev/null && cmux notify --title 'Claude Code' --body 'Waiting for input' || osascript -e 'display notification \"Waiting for input\" with title \"Claude Code\"'"
          }
        ]
      },
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "command -v cmux &>/dev/null && cmux notify --title 'Claude Code' --subtitle 'Permission' --body 'Approval needed' || osascript -e 'display notification \"Approval needed\" with title \"Claude Code\"'"
          }
        ]
      }
    ]
  }
}
```

Falls back to vanilla macOS notifications when cmux isn't running — safe to leave in permanently.

---

## Environment variables injected into every child shell

| Variable | Description |
|---|---|
| `CMUX_SOCKET_PATH` | Path to the control socket |
| `CMUX_TAB_ID` | UUID of the current tab/workspace |
| `CMUX_PANEL_ID` | UUID of the current panel |

Scripts and extensions can use these to self-identify and call back to cmux.

---

## Socket API (v2 — JSON, designed for LLM agents)

The v2 protocol is newline-delimited JSON with stable handles (`window_id`, `workspace_id`, `pane_id`, `surface_id`). Send a request, get a response. Designed specifically for agents to control the terminal programmatically.

### Request/response format

```json
{"id":"1","method":"workspace.list","params":{}}
{"id":"1","ok":true,"result":{...}}

// Error
{"id":"1","ok":false,"error":{"code":"not_found","message":"workspace not found"}}
```

### Available methods

**Windows**
- `window.list` / `window.current` / `window.focus` / `window.create` / `window.close`

**Workspaces**
- `workspace.list` / `workspace.create` / `workspace.select` / `workspace.current` / `workspace.close` / `workspace.move_to_window`

**Surfaces / Splits**
- `surface.list` / `surface.focus` / `surface.split` / `surface.create` / `surface.close`
- `surface.drag_to_split` / `surface.refresh` / `surface.health`
- `surface.trigger_flash` — visually flash a surface so you can see which one an agent is in

**Panes**
- `pane.list` / `pane.focus` / `pane.surfaces` / `pane.create`

**Input**
- `surface.send_text` — send text to a surface
- `surface.send_key` — send a keypress to a surface

**Notifications**
- `notification.create` / `notification.create_for_surface` / `notification.list` / `notification.clear`

**Browser**
- `browser.open_split` / `browser.navigate` / `browser.back` / `browser.forward` / `browser.reload`
- `browser.url.get` / `browser.focus_webview` / `browser.is_webview_focused`

### Example: spawn a Claude Code session in a new workspace programmatically

```bash
SOCKET="$CMUX_SOCKET_PATH"

# Create a new workspace
WS=$(echo '{"id":"1","method":"workspace.create","params":{}}' | nc -U "$SOCKET")
WS_ID=$(echo "$WS" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['workspace_id'])")

# Split a pane and send a command
echo "{\"id\":\"2\",\"method\":\"surface.send_text\",\"params\":{\"workspace_id\":\"$WS_ID\",\"text\":\"claude\n\"}}" | nc -U "$SOCKET"
```

---

## In-app browser — agent automation API

Ported from `vercel-labs/agent-browser`. Agents can drive the browser directly.

```bash
cmux browser navigate "http://localhost:3000"
cmux browser snapshot          # dumps accessibility tree (LLM-readable)
cmux browser click "button[type=submit]"
cmux browser fill "#search" "query text"
cmux browser eval "document.title"
cmux browser screenshot
cmux browser get text "h1"
cmux browser find role "button"
cmux browser is visible ".modal"
cmux browser scroll ".container" 0 500
cmux browser press "Enter"
cmux browser wait ".spinner" --hidden
cmux browser tab new
cmux browser cookies
cmux browser storage local get "key"
```

---

## Keyboard shortcuts

### Workspaces
| Shortcut | Action |
|---|---|
| `Cmd+N` | New workspace |
| `Cmd+1–8` | Jump to workspace 1–8 |
| `Cmd+9` | Jump to last workspace |
| `Ctrl+Cmd+]` | Next workspace |
| `Ctrl+Cmd+[` | Previous workspace |
| `Cmd+Shift+W` | Close workspace |
| `Cmd+B` | Toggle sidebar |

### Surfaces (tabs within a pane)
| Shortcut | Action |
|---|---|
| `Cmd+T` | New surface |
| `Cmd+Shift+]` | Next surface |
| `Cmd+Shift+[` | Previous surface |
| `Ctrl+Tab` | Next surface |
| `Ctrl+1–8` | Jump to surface 1–8 |
| `Cmd+W` | Close surface |

### Split panes
| Shortcut | Action |
|---|---|
| `Cmd+D` | Split right |
| `Cmd+Shift+D` | Split down |
| `Option+Cmd+← → ↑ ↓` | Focus pane directionally |
| `Cmd+Shift+H` | Flash focused panel |

### Browser
| Shortcut | Action |
|---|---|
| `Cmd+Shift+L` | Open browser in split |
| `Cmd+L` | Focus address bar |
| `Cmd+[` | Back |
| `Cmd+]` | Forward |
| `Cmd+R` | Reload |
| `Option+Cmd+I` | Open DevTools |

### Notifications
| Shortcut | Action |
|---|---|
| `Cmd+I` | Show notifications panel |
| `Cmd+Shift+U` | Jump to latest unread |

### Terminal
| Shortcut | Action |
|---|---|
| `Cmd+K` | Clear scrollback |
| `Cmd+F` | Find |
| `Cmd+G` / `Cmd+Shift+G` | Find next / previous |
| `Cmd++` / `Cmd+-` | Increase / decrease font size |
| `Cmd+0` | Reset font size |

---

## What this enables for your AI workflow

- Run Claude Code, Codex, Gemini CLI, Amp, OpenCode in parallel — each in its own workspace with full sidebar context
- Hook `cmux notify` into Claude Code hooks so you always know which session needs you with real context, not generic macOS pings
- Use the JSON socket API from pi extensions or subagents to spin up new workspaces, split panes, and send keystrokes programmatically
- Have agents drive your local dev server via the in-app browser without any extra Playwright/Puppeteer setup
- `Cmd+Shift+U` to jump instantly to whatever agent is blocked — no hunting through tabs
