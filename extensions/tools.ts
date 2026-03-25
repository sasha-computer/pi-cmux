/**
 * Custom tools exposed to the LLM for controlling cmux programmatically.
 *
 * - cmux_browser: Drive the in-app browser (open, navigate, snapshot, click, fill, eval, etc.)
 * - cmux_workspace: Control workspaces and surfaces (list, create, split, focus, flash, send text)
 * - cmux_notify: Send a notification to the user via cmux
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateTail } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import type { CmuxClient } from "./cmux-client.js";

/** Format a cmux response as a proper AgentToolResult. */
function formatResult(result: any): { content: { type: "text"; text: string }[]; details: undefined } {
  let text: string;
  if (result === null || result === undefined) {
    text = "cmux did not respond (socket unavailable or timed out)";
  } else if (typeof result === "string") {
    text = result;
  } else {
    const json = JSON.stringify(result, null, 2);
    // Truncate large responses (snapshots can be huge)
    const truncated = truncateTail(json, { maxBytes: 50_000, maxLines: 2000 });
    text = truncated.content;
  }
  return { content: [{ type: "text", text }], details: undefined };
}

export function wireTools(pi: ExtensionAPI, client: CmuxClient): void {
  // --- cmux_browser ---
  pi.registerTool({
    name: "cmux_browser",
    description: [
      "Control the cmux in-app browser. Open URLs in a split pane, navigate, take accessibility snapshots, click elements, fill forms, evaluate JS, and more.",
      "The browser runs inside the cmux terminal app — no separate browser needed.",
      "",
      "Actions:",
      "- open: Open a URL in a new browser split pane",
      "- navigate: Navigate the current browser to a URL",
      "- snapshot: Get the accessibility tree of the current page (LLM-readable)",
      "- click: Click an element by CSS selector",
      "- fill: Fill a form field by CSS selector with text",
      "- eval: Evaluate JavaScript in the page and return the result",
      "- screenshot: Take a screenshot of the page",
      "- get_text: Get the text content of an element by CSS selector",
      "- get_url: Get the current page URL",
      "- wait: Wait for an element to appear or disappear (set hidden=true to wait for disappearance)",
      "- back: Go back in browser history",
      "- forward: Go forward in browser history",
      "- reload: Reload the current page",
      "- press: Send a keypress to the page (e.g. 'Enter', 'Tab', 'Escape')",
      "- scroll: Scroll an element (specify selector, dx, dy)",
      "- find_role: Find elements by ARIA role",
      "- is_visible: Check if an element is visible",
    ].join("\n"),
    parameters: Type.Object({
      action: StringEnum([
        "open", "navigate", "snapshot", "click", "fill",
        "eval", "screenshot", "get_text", "get_url", "wait",
        "back", "forward", "reload", "press", "scroll",
        "find_role", "is_visible",
      ] as const),
      url: Type.Optional(Type.String({ description: "URL for open/navigate actions" })),
      selector: Type.Optional(Type.String({ description: "CSS selector for click/fill/get_text/wait/scroll/is_visible" })),
      text: Type.Optional(Type.String({ description: "Text for fill action, or key name for press action" })),
      code: Type.Optional(Type.String({ description: "JavaScript code for eval action" })),
      role: Type.Optional(Type.String({ description: "ARIA role for find_role action" })),
      surface_id: Type.Optional(Type.String({ description: "Target browser surface ID (uses current if omitted)" })),
      hidden: Type.Optional(Type.Boolean({ description: "For wait action: true to wait until element disappears" })),
      dx: Type.Optional(Type.Number({ description: "Horizontal scroll amount for scroll action" })),
      dy: Type.Optional(Type.Number({ description: "Vertical scroll amount for scroll action" })),
    }),
    async execute(_toolCallId, params) {
      const surfaceParams = params.surface_id ? { surface_id: params.surface_id } : {};

      switch (params.action) {
        case "open": {
          if (!params.url) return formatResult("Error: url is required for open action");
          const result = await client.request("browser.open_split", { url: params.url, ...surfaceParams });
          return formatResult(result ?? "Browser split opened");
        }
        case "navigate": {
          if (!params.url) return formatResult("Error: url is required for navigate action");
          const result = await client.request("browser.navigate", { url: params.url, ...surfaceParams });
          return formatResult(result ?? "Navigated");
        }
        case "snapshot": {
          const result = await client.request("browser.snapshot", surfaceParams);
          return formatResult(result);
        }
        case "click": {
          if (!params.selector) return formatResult("Error: selector is required for click action");
          const result = await client.request("browser.click", { selector: params.selector, ...surfaceParams });
          return formatResult(result ?? "Clicked");
        }
        case "fill": {
          if (!params.selector) return formatResult("Error: selector is required for fill action");
          if (params.text === undefined) return formatResult("Error: text is required for fill action");
          const result = await client.request("browser.fill", { selector: params.selector, text: params.text, ...surfaceParams });
          return formatResult(result ?? "Filled");
        }
        case "eval": {
          if (!params.code) return formatResult("Error: code is required for eval action");
          const result = await client.request("browser.eval", { code: params.code, ...surfaceParams });
          return formatResult(result);
        }
        case "screenshot": {
          const result = await client.request("browser.screenshot", surfaceParams);
          return formatResult(result);
        }
        case "get_text": {
          if (!params.selector) return formatResult("Error: selector is required for get_text action");
          const result = await client.request("browser.get_text", { selector: params.selector, ...surfaceParams });
          return formatResult(result);
        }
        case "get_url": {
          const result = await client.request("browser.url.get", surfaceParams);
          return formatResult(result);
        }
        case "wait": {
          if (!params.selector) return formatResult("Error: selector is required for wait action");
          const waitParams: Record<string, any> = { selector: params.selector, ...surfaceParams };
          if (params.hidden) waitParams.hidden = true;
          const result = await client.request("browser.wait", waitParams);
          return formatResult(result ?? "Element found");
        }
        case "back": {
          const result = await client.request("browser.back", surfaceParams);
          return formatResult(result ?? "Navigated back");
        }
        case "forward": {
          const result = await client.request("browser.forward", surfaceParams);
          return formatResult(result ?? "Navigated forward");
        }
        case "reload": {
          const result = await client.request("browser.reload", surfaceParams);
          return formatResult(result ?? "Reloaded");
        }
        case "press": {
          if (!params.text) return formatResult("Error: text (key name) is required for press action");
          const result = await client.request("browser.press", { key: params.text, ...surfaceParams });
          return formatResult(result ?? "Key pressed");
        }
        case "scroll": {
          if (!params.selector) return formatResult("Error: selector is required for scroll action");
          const result = await client.request("browser.scroll", {
            selector: params.selector,
            dx: params.dx ?? 0,
            dy: params.dy ?? 0,
            ...surfaceParams,
          });
          return formatResult(result ?? "Scrolled");
        }
        case "find_role": {
          if (!params.role) return formatResult("Error: role is required for find_role action");
          const result = await client.request("browser.find.role", { role: params.role, ...surfaceParams });
          return formatResult(result);
        }
        case "is_visible": {
          if (!params.selector) return formatResult("Error: selector is required for is_visible action");
          const result = await client.request("browser.is_visible", { selector: params.selector, ...surfaceParams });
          return formatResult(result);
        }
        default:
          return formatResult(`Unknown action: ${params.action}`);
      }
    },
  });

  // --- cmux_workspace ---
  pi.registerTool({
    name: "cmux_workspace",
    description: [
      "Control cmux workspaces and surfaces. List workspaces, create new ones, split panes, focus surfaces, flash surfaces, send text to other terminals, and identify the current context.",
      "",
      "Actions:",
      "- list: List all workspaces and their surfaces",
      "- create: Create a new workspace",
      "- split: Split a surface (direction: right or down)",
      "- focus: Focus a specific surface by ID",
      "- flash: Visually flash a surface to identify it",
      "- identify: Get the current focused context (window, workspace, pane, surface)",
      "- send_text: Send text to a surface (e.g. type a command into another terminal pane)",
      "- send_key: Send a keypress to a surface",
      "- close: Close a surface",
    ].join("\n"),
    parameters: Type.Object({
      action: StringEnum([
        "list", "create", "split", "focus", "flash",
        "identify", "send_text", "send_key", "close",
      ] as const),
      surface_id: Type.Optional(Type.String({ description: "Target surface ID for focus/flash/split/send_text/send_key/close" })),
      workspace_id: Type.Optional(Type.String({ description: "Target workspace ID for create/list operations" })),
      direction: Type.Optional(StringEnum(["right", "down"] as const, { description: "Split direction (default: right)" })),
      text: Type.Optional(Type.String({ description: "Text to send for send_text, or key name for send_key" })),
    }),
    async execute(_toolCallId, params) {
      switch (params.action) {
        case "list": {
          const result = await client.request("workspace.list", {});
          return formatResult(result);
        }
        case "create": {
          const result = await client.request("workspace.create", {});
          return formatResult(result);
        }
        case "split": {
          const splitParams: Record<string, any> = {};
          if (params.surface_id) splitParams.surface_id = params.surface_id;
          if (params.direction) splitParams.direction = params.direction;
          const result = await client.request("surface.split", splitParams);
          return formatResult(result);
        }
        case "focus": {
          if (!params.surface_id) return formatResult("Error: surface_id is required for focus action");
          const result = await client.request("surface.focus", { surface_id: params.surface_id });
          return formatResult(result ?? "Focused");
        }
        case "flash": {
          if (!params.surface_id) return formatResult("Error: surface_id is required for flash action");
          const result = await client.request("surface.trigger_flash", { surface_id: params.surface_id });
          return formatResult(result ?? "Flashed");
        }
        case "identify": {
          const result = await client.request("system.identify", {});
          return formatResult(result);
        }
        case "send_text": {
          if (!params.surface_id) return formatResult("Error: surface_id is required for send_text action");
          if (!params.text) return formatResult("Error: text is required for send_text action");
          const result = await client.request("surface.send_text", { surface_id: params.surface_id, text: params.text });
          return formatResult(result ?? "Text sent");
        }
        case "send_key": {
          if (!params.surface_id) return formatResult("Error: surface_id is required for send_key action");
          if (!params.text) return formatResult("Error: text (key name) is required for send_key action");
          const result = await client.request("surface.send_key", { surface_id: params.surface_id, key: params.text });
          return formatResult(result ?? "Key sent");
        }
        case "close": {
          if (!params.surface_id) return formatResult("Error: surface_id is required for close action");
          const result = await client.request("surface.close", { surface_id: params.surface_id });
          return formatResult(result ?? "Closed");
        }
        default:
          return formatResult(`Unknown action: ${params.action}`);
      }
    },
  });

  // --- cmux_notify ---
  pi.registerTool({
    name: "cmux_notify",
    description: "Send a notification to the user via cmux. Use when you need to explicitly get the user's attention — e.g. a long task finished, something needs review, or you have a question.",
    parameters: Type.Object({
      title: Type.String({ description: "Notification title" }),
      subtitle: Type.Optional(Type.String({ description: "Notification subtitle (shown smaller, below title)" })),
      body: Type.Optional(Type.String({ description: "Notification body text" })),
    }),
    async execute(_toolCallId, params) {
      const surfaceId = process.env.CMUX_SURFACE_ID;

      if (surfaceId) {
        const result = await client.request("notification.create_for_surface", {
          surface_id: surfaceId,
          title: params.title,
          subtitle: params.subtitle ?? "",
          body: params.body ?? "",
        });
        return formatResult(result ?? "Notification sent");
      }

      const result = await client.request("notification.create", {
        title: params.title,
        subtitle: params.subtitle ?? "",
        body: params.body ?? "",
      });
      return formatResult(result ?? "Notification sent");
    },
  });
}
