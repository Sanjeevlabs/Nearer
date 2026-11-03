// Minimal agent runtime (M4): runAgent(goal, tools, maxSteps=6).
// Basic tool-calling loop (recipe-intent 02_agent_patterns/01 + tool calling
// 01_api_fundamentals/03). Agents NEVER act directly: tool results become
// `suggestions`, and route handlers execute them only after Review / Approve.
// Every invocation logs an agent_run (trace page) and respects the spend cap
// through the shared ledger.
import { isMockMode } from "./config";
import { activeProvider, providerKey, PROVIDERS } from "./config";
import type { SpendLedger, LlmStore } from "./llm";
import { MODEL_TIMEOUT_MS, deadline } from "./timeouts";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AgentSuggestionDraft {
  goal: string;
  payload: Record<string, unknown>;
}

export interface AgentResult {
  suggestions: AgentSuggestionDraft[];
  toolCalls: { name: string; args: Record<string, unknown> }[];
  cached: boolean;
  cost: number;
  status: string;
}

// A tool may hand back a ready suggestion ({ suggestion: { goal, payload } });
// otherwise the result is wrapped with the tool name and args. draft:false = nothing to propose.
function draftFrom(goal: string, name: string, args: Record<string, unknown>, out: unknown): AgentSuggestionDraft | null {
  const o = out as { draft?: unknown; suggestion?: AgentSuggestionDraft } | null;
  if (o && o.draft === false) return null;
  if (o?.suggestion && typeof o.suggestion.goal === "string") return o.suggestion;
  return { goal, payload: { action: name, args, result: out } };
}

// Mock planner: deterministic keyword -> tool mapping, no model. The live
// path below uses real tool calling; both end in suggestions, never actions.
async function mockPlan(goal: string, tools: AgentTool[]): Promise<AgentResult> {
  const g = goal.toLowerCase();
  const byName = new Map(tools.map((t) => [t.name, t]));
  const toolCalls: AgentResult["toolCalls"] = [];
  const suggestions: AgentSuggestionDraft[] = [];
  const pick = async (name: string, args: Record<string, unknown>) => {
    const tool = byName.get(name);
    if (!tool) return;
    toolCalls.push({ name, args });
    const out = await tool.run(args);
    const d = draftFrom(goal, name, args, out);
    if (d) suggestions.push(d);
  };
  if (/letter/.test(g)) {
    await pick("draft_weekly_letter", {});
  } else if (/role|teach|bless.*exam|ikigai/.test(g)) {
    await pick("assign_daily_role", { goal });
  } else if (/wish|birthday|blessing|reel/.test(g)) {
    await pick("request_wish", { goal });
  } else if (/gather|evening|together|playlist/.test(g)) {
    await pick("create_gather_session", { goal });
  } else if (/card|memory|photo|voice/.test(g)) {
    await pick("create_card", { goal });
  } else {
    const first = tools[0];
    if (first) await pick(first.name, { goal });
  }
  return { suggestions, toolCalls, cached: false, cost: 0, status: "done" };
}

const AGENT_SYSTEM =
  "You are Nearer's family ritual assistant. Reply with JSON only: " +
  '{"steps": [{"tool": "<tool-name>", "args": {}}]}. ' +
  "Use at most 6 steps. Never invent people or events; only use tool results.";

async function liveLoop(
  goal: string,
  tools: AgentTool[],
  maxSteps: number,
  store: LlmStore,
  ledger: SpendLedger,
): Promise<AgentResult> {
  const provider = activeProvider();
  const cfg = PROVIDERS[provider];
  const key = providerKey(provider);
  if (!key) throw new Error("missing-key");
  const specs = tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const toolCalls: AgentResult["toolCalls"] = [];
  const suggestions: AgentSuggestionDraft[] = [];
  let cost = 0;
  // Prompt caching intent: the system prompt is long-lived and identical
  // across runs; providers that support caching pick it up by prefix.
  const messages: { role: string; content: string }[] = [
    { role: "system", content: AGENT_SYSTEM },
    { role: "user", content: goal },
  ];
  for (let step = 0; step < Math.min(6, Math.max(1, maxSteps)); step++) {
    if (!(await ledger.check(0.01))) break;
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      signal: deadline(MODEL_TIMEOUT_MS),
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: cfg.captionModel,
        messages,
        tools: specs,
        tool_choice: "auto",
        max_tokens: 600,
      }),
    });
    if (!res.ok) throw new Error(`provider-${res.status}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
      usage?: { cost_usd?: number };
    };
    const msg = data.choices?.[0]?.message;
    cost += typeof data.usage?.cost_usd === "number" ? data.usage.cost_usd : 0.01;
    const calls = msg?.tool_calls ?? [];
    if (calls.length === 0) break;
    for (const c of calls) {
      const name = c.function?.name ?? "";
      const tool = tools.find((t) => t.name === name);
      if (!tool) continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.function?.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      toolCalls.push({ name, args });
      const out = await tool.run(args);
      const d = draftFrom(goal, name, args, out);
      if (d) suggestions.push(d);
      messages.push({ role: "user", content: `Tool ${name} returned: ${JSON.stringify(out).slice(0, 2000)}` });
    }
    if (toolCalls.length > 0) break;
  }
  await ledger.commit(cost);
  void store;
  return { suggestions, toolCalls, cached: false, cost, status: "done" };
}

export async function runAgent(
  goal: string,
  tools: AgentTool[],
  opts: { store?: LlmStore; ledger?: SpendLedger; maxSteps?: number } = {},
): Promise<AgentResult> {
  const maxSteps = opts.maxSteps ?? 6;
  if (isMockMode()) return mockPlan(goal, tools);
  const { memoryStore, SpendLedger } = await import("./llm");
  const store = opts.store ?? memoryStore();
  const ledger = opts.ledger ?? new SpendLedger(store);
  try {
    return await liveLoop(goal, tools, maxSteps, store, ledger);
  } catch {
    return { suggestions: [], toolCalls: [], cached: false, cost: 0, status: "fallback" };
  }
}
