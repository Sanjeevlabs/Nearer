// Minimal server-side MCP client over Streamable HTTP (spec 2025-06-18):
// JSON-RPC 2.0 POSTs for initialize, tools/list and tools/call. Accepts a
// plain JSON reply or an SSE stream (text/event-stream) and picks the
// response whose id matches. 8 s timeout per request, body included.
// Zod checks every shape we read. No SDK dependency. Server only.
// Never log the bearer token.
import { z } from "zod";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_TIMEOUT_MS = 8000;

export type McpErrorCode = "timeout" | "unauthorized" | "http" | "rpc" | "protocol" | "network";

export class McpError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "McpError";
  }
}

const RpcErrorSchema = z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() });
const RpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: RpcErrorSchema.optional(),
});

const InitializeResultSchema = z.object({
  protocolVersion: z.string(),
  serverInfo: z.object({ name: z.string(), version: z.string().optional() }).passthrough().optional(),
  capabilities: z.record(z.unknown()).default({}),
});

const ToolSchema = z.object({ name: z.string(), description: z.string().optional(), inputSchema: z.unknown().optional() });
const ToolsListSchema = z.object({ tools: z.array(ToolSchema), nextCursor: z.string().optional() });
export type McpTool = z.infer<typeof ToolSchema>;

const ContentSchema = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
export const ToolResultSchema = z.object({
  content: z.array(ContentSchema).default([]),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});
export type McpToolResult = z.infer<typeof ToolResultSchema>;

/** Parse an SSE body into its `data:` payloads (one per event). */
export function parseSse(body: string): string[] {
  const out: string[] = [];
  for (const block of body.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""));
    if (data.length) out.push(data.join("\n"));
  }
  return out;
}

/** The JSON a tool returned: structuredContent, else the first text block parsed as JSON. */
export function toolJson(result: McpToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  for (const c of result.content) {
    if (c.type !== "text" || !c.text) continue;
    try {
      return JSON.parse(c.text) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

export interface McpClientOptions {
  /** Bearer token for mcp-oauth partners. Kept private to this instance. */
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class McpClient {
  private readonly token: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private sessionId: string | null = null;
  private initialized = false;
  private nextId = 1;

  constructor(
    readonly url: string,
    opts: McpClientOptions = {},
  ) {
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? MCP_TIMEOUT_MS;
    this.fetchFn = opts.fetchImpl ?? fetch;
  }

  private async post(payload: Record<string, unknown>, expectReply: boolean): Promise<unknown> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.initialized) headers["mcp-protocol-version"] = MCP_PROTOCOL_VERSION;
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchFn(this.url, { method: "POST", headers, body: JSON.stringify(payload), signal: ctrl.signal, cache: "no-store" });
      } catch (err) {
        if (ctrl.signal.aborted) throw new McpError("timeout", "mcp-timeout");
        throw new McpError("network", err instanceof Error ? err.name : "network");
      }
      const sid = res.headers.get("mcp-session-id");
      if (sid) this.sessionId = sid;
      if (res.status === 401 || res.status === 403) throw new McpError("unauthorized", "mcp-unauthorized", res.status);
      if (!expectReply) return null;
      if (!res.ok) throw new McpError("http", `mcp-http-${res.status}`, res.status);
      let text: string;
      try {
        text = await res.text();
      } catch {
        if (ctrl.signal.aborted) throw new McpError("timeout", "mcp-timeout");
        throw new McpError("network", "mcp-body");
      }
      const type = res.headers.get("content-type") ?? "";
      const candidates = type.includes("text/event-stream") ? parseSse(text) : [text];
      for (const raw of candidates) {
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          continue;
        }
        const parsed = RpcResponseSchema.safeParse(json);
        if (!parsed.success || parsed.data.id !== payload.id) continue;
        if (parsed.data.error) {
          // -32001 is how some servers (Swiggy) report auth failure in-band.
          if (parsed.data.error.code === -32001) throw new McpError("unauthorized", "mcp-unauthorized");
          throw new McpError("rpc", `mcp-rpc-${parsed.data.error.code}`);
        }
        return parsed.data.result;
      }
      throw new McpError("protocol", "mcp-no-response");
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return this.post({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }, true);
  }

  async initialize(): Promise<z.infer<typeof InitializeResultSchema>> {
    const result = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "nearer", version: "0.1.0" },
    });
    const parsed = InitializeResultSchema.safeParse(result);
    if (!parsed.success) throw new McpError("protocol", "mcp-bad-initialize");
    this.initialized = true;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, false).catch(() => undefined);
    return parsed.data;
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  async listTools(): Promise<McpTool[]> {
    await this.ensureInit();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const parsed = ToolsListSchema.safeParse(await this.request("tools/list", cursor ? { cursor } : undefined));
      if (!parsed.success) throw new McpError("protocol", "mcp-bad-tools-list");
      tools.push(...parsed.data.tools);
      cursor = parsed.data.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    await this.ensureInit();
    const parsed = ToolResultSchema.safeParse(await this.request("tools/call", { name, arguments: args }));
    if (!parsed.success) throw new McpError("protocol", "mcp-bad-tool-result");
    if (parsed.data.isError) throw new McpError("rpc", `mcp-tool-error:${name}`);
    return parsed.data;
  }
}
