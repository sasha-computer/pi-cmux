/**
 * cmux socket client — persistent connection to the cmux Unix domain socket.
 * Speaks v2 newline-delimited JSON protocol.
 *
 * Gracefully degrades: if CMUX_SOCKET_PATH is unset or the socket is
 * unreachable, every method returns null. No errors, no noise.
 */

import * as net from "node:net";
import * as crypto from "node:crypto";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CmuxClient {
  private socket: net.Socket | null = null;
  private pending = new Map<string, PendingRequest>();
  private buffer = "";
  private socketPath: string | undefined;
  private connecting = false;
  private verbose: boolean;

  constructor() {
    this.socketPath = process.env.CMUX_SOCKET_PATH;
    this.verbose = process.env.PI_CMUX_VERBOSE === "1";
  }

  /** True if CMUX_SOCKET_PATH is set (cmux might be available). */
  get available(): boolean {
    return !!this.socketPath && process.env.PI_CMUX_DISABLE !== "1";
  }

  /** True if we have an active socket connection. */
  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  /** Connect to the cmux socket. Returns true on success. */
  async connect(): Promise<boolean> {
    if (!this.available) return false;
    if (this.isConnected()) return true;
    if (this.connecting) return false;

    this.connecting = true;

    try {
      return await new Promise<boolean>((resolve) => {
        const sock = net.createConnection(this.socketPath!, () => {
          this.socket = sock;
          this.connecting = false;
          if (this.verbose) console.error("[pi-cmux] connected");
          resolve(true);
        });

        sock.on("data", (data) => this.onData(data));

        sock.on("error", (err) => {
          if (this.verbose) console.error("[pi-cmux] socket error:", err.message);
          this.connecting = false;
          this.cleanup();
          resolve(false);
        });

        sock.on("close", () => {
          if (this.verbose) console.error("[pi-cmux] socket closed");
          this.cleanup();
        });

        // Connection timeout
        sock.setTimeout(3000, () => {
          if (this.verbose) console.error("[pi-cmux] connection timeout");
          sock.destroy();
          this.connecting = false;
          resolve(false);
        });
      });
    } catch {
      this.connecting = false;
      return false;
    }
  }

  /** Send a v2 JSON request. Returns the result or null on failure. */
  async request(method: string, params?: Record<string, any>): Promise<any | null> {
    // Auto-reconnect
    if (!this.isConnected()) {
      const ok = await this.connect();
      if (!ok) return null;
    }

    const id = crypto.randomUUID();
    const payload = JSON.stringify({ id, method, params: params ?? {} });

    if (this.verbose) console.error("[pi-cmux] ->", payload);

    return new Promise<any | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (this.verbose) console.error("[pi-cmux] request timeout:", method);
        resolve(null);
      }, 5000);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          this.pending.delete(id);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timer);
          this.pending.delete(id);
          if (this.verbose) console.error("[pi-cmux] request error:", reason);
          resolve(null);
        },
        timer,
      });

      try {
        this.socket!.write(payload + "\n");
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  /** Close the connection. */
  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.cleanup();
  }

  // --- internals ---

  private onData(data: Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (this.verbose) console.error("[pi-cmux] <-", line);

        const pending = this.pending.get(msg.id);
        if (pending) {
          if (msg.ok === false) {
            pending.reject(msg.error?.message ?? "unknown error");
          } else {
            pending.resolve(msg.result ?? null);
          }
        }
      } catch {
        if (this.verbose) console.error("[pi-cmux] parse error:", line);
      }
    }
  }

  private cleanup(): void {
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.resolve(null);
    }
    this.pending.clear();
    this.buffer = "";
    this.socket = null;
  }
}
