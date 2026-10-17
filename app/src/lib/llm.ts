// LLM client: Gemini on Vertex AI (Application Default Credentials, no API key), then the llm_cache (golden answers).
// JSON mode via responseMimeType, empty content treated as failure, thinking budget set per role.
// Every successful answer is cached; every call is written to ai_audit.
import crypto from "node:crypto";
import { GoogleGenAI, type Content, type GenerateContentConfig, type Part } from "@google/genai";
import { env } from "./env.ts";
import { get, run } from "./db.ts";
import type { Provider } from "./types.ts";

export type ModelRole = "chat" | "fast";

interface JsonResult<T> {
  data: T;
  provider: Provider;
  model: string;
}

// ---------------------------------------------------------------- Vertex AI client
const clients = new Map<string, GoogleGenAI>();

function client(location: string): GoogleGenAI {
  let c = clients.get(location);
  if (!c) {
    c = new GoogleGenAI({ vertexai: true, project: env("GOOGLE_CLOUD_PROJECT"), location });
    clients.set(location, c);
  }
  return c;
}

/** Gemini chat models: `global` gives the widest model availability. */
const chatClient = () => client(env("LLM_LOCATION") || env("GOOGLE_CLOUD_LOCATION", "global"));
/** Embeddings stay regional. */
const embedClient = () => client(env("LLM_EMBED_LOCATION") || env("GOOGLE_CLOUD_LOCATION", "us-central1"));

export function vertexReady(): boolean {
  return !!env("GOOGLE_CLOUD_PROJECT") && env("LLM_DISABLE_VERTEX") !== "true";
}

const modelFor = (role: ModelRole) => (role === "chat" ? env("LLM_CHAT_MODEL") : env("LLM_FAST_MODEL"));
const timeoutMs = () => Number(env("LLM_TIMEOUT_S", "30")) * 1000;

/** LLM_CHAT_THINKING / LLM_FAST_THINKING: a token budget (0 = off) or a level (MINIMAL, LOW, MEDIUM, HIGH). */
function thinking(role: ModelRole): { config: GenerateContentConfig["thinkingConfig"]; budget: number } {
  const raw = env(role === "chat" ? "LLM_CHAT_THINKING" : "LLM_FAST_THINKING", role === "chat" ? "512" : "0").trim();
  if (/^-?\d+$/.test(raw)) {
    const budget = Number(raw);
    return { config: { thinkingBudget: budget }, budget: Math.max(0, budget) };
  }
  return { config: { thinkingLevel: raw.toUpperCase() as never }, budget: 1024 };
}

/** Visible text of a response, thoughts excluded. */
function textOf(parts: Part[] | undefined): string {
  return (parts ?? []).filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("").trim();
}

function parseJsonContent(content: unknown): unknown {
  if (typeof content !== "string" || !content.trim()) throw new Error("empty content");
  const text = content.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  return JSON.parse(text);
}

// ---------------------------------------------------------------- cache + audit
export function cacheKey(role: ModelRole, system: string, user: string): string {
  return crypto.createHash("sha256").update(`${role}\n${system}\n${user}`).digest("hex");
}

function readCache<T>(key: string): JsonResult<T> | null {
  try {
    const row = get<{ response: string; model: string }>("SELECT response, model FROM llm_cache WHERE key = ?", key);
    return row ? { data: JSON.parse(row.response) as T, provider: "cache", model: row.model } : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, model: string, provider: Provider, data: unknown): void {
  try {
    run("INSERT OR REPLACE INTO llm_cache (key, model, provider, response, created_at) VALUES (?, ?, ?, ?, ?)",
      key, model, provider, JSON.stringify(data), new Date().toISOString());
  } catch {
    /* cache is best effort */
  }
}

export function audit(kind: string, inputRef: string, output: unknown, model: string, provider: Provider): void {
  try {
    run("INSERT INTO ai_audit (kind, input_ref, output, model, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      kind, inputRef, JSON.stringify(output).slice(0, 4000), model, provider, new Date().toISOString());
  } catch {
    /* audit is best effort */
  }
}

// ---------------------------------------------------------------- JSON answers
export interface InlineFile { mimeType: string; data: Buffer }

/**
 * Ask Gemini for JSON. Order: (cache if LLM_MODE=cache-first) -> Gemini on Vertex AI -> cache -> throw.
 * `files` are sent inline (multimodal, e.g. a PDF); they are part of the cache key by content hash.
 * Callers provide their own template fallback when this throws.
 */
export async function chatJson<T>(role: ModelRole, system: string, user: string,
  opts: { maxTokens?: number; kind?: string; files?: InlineFile[] } = {}): Promise<JsonResult<T>> {
  const fileHash = (opts.files ?? []).map((f) => crypto.createHash("sha256").update(f.data).digest("hex").slice(0, 16)).join(",");
  const key = cacheKey(role, system, fileHash ? `${user}\n[files:${fileHash}]` : user);
  const kind = opts.kind ?? role;
  if (env("LLM_MODE", "live") === "cache-first") {
    const hit = readCache<T>(key);
    if (hit) return hit;
  }
  const errors: string[] = [];
  const model = modelFor(role);
  if (vertexReady() && model) {
    try {
      const t = thinking(role);
      const parts: Part[] = [...(opts.files ?? []).map((f) => ({ inlineData: { mimeType: f.mimeType, data: f.data.toString("base64") } })), { text: user }];
      const r = await chatClient().models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: system, temperature: 0, responseMimeType: "application/json",
          maxOutputTokens: (opts.maxTokens ?? 800) + t.budget, thinkingConfig: t.config, httpOptions: { timeout: timeoutMs() },
        },
      });
      const data = parseJsonContent(textOf(r.candidates?.[0]?.content?.parts)) as T;
      writeCache(key, model, "vertex", data);
      audit(kind, key.slice(0, 16), data, model, "vertex");
      return { data, provider: "vertex", model };
    } catch (e) {
      errors.push(`vertex: ${safeError(e)}`);
    }
  }
  const hit = readCache<T>(key);
  if (hit) return hit;
  throw new Error(`Gemini unavailable: ${errors.join(" | ") || "not configured"}`);
}

// ---------------------------------------------------------------- embeddings
/** Embeddings from Vertex (`gemini-embedding-001`), one text per request, a few in flight. Throws when unavailable. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!vertexReady()) throw new Error("Vertex AI not configured");
  const model = env("LLM_EMBED_MODEL", "gemini-embedding-001");
  const dims = Number(env("LLM_EMBED_DIMS", "768"));
  const out: number[][] = new Array(texts.length);
  const pool = 8;
  for (let i = 0; i < texts.length; i += pool) {
    await Promise.all(texts.slice(i, i + pool).map(async (text, j) => {
      const r = await embedClient().models.embedContent({
        model, contents: text, config: { outputDimensionality: dims, taskType: "SEMANTIC_SIMILARITY", httpOptions: { timeout: timeoutMs() } },
      });
      const v = r.embeddings?.[0]?.values;
      if (!v?.length) throw new Error("empty embedding");
      out[i + j] = v;
    }));
  }
  return out;
}

// ---------------------------------------------------------------- tool calling (Concierge agent)
export interface ToolSpec { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
/** `parts` keeps Gemini's raw model turn (incl. thought signatures) so it can be replayed exactly. */
export interface ChatMsg { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; parts?: Part[] }

export type ToolProvider = "vertex";

/** Providers that can run a tool-calling loop, in order. */
export function toolProviders(): ToolProvider[] {
  return vertexReady() && env("LLM_CHAT_MODEL") ? ["vertex"] : [];
}

/** Map the provider-neutral conversation to Gemini contents: tool results become functionResponse parts, grouped per turn. */
function toContents(messages: ChatMsg[]): { system: string; contents: Content[] } {
  const names = new Map<string, string>();
  const contents: Content[] = [];
  let system = "";
  for (const m of messages) {
    if (m.role === "system") { system += (system ? "\n" : "") + (m.content ?? ""); continue; }
    if (m.role === "user") { contents.push({ role: "user", parts: [{ text: m.content ?? "" }] }); continue; }
    if (m.role === "assistant") {
      for (const c of m.tool_calls ?? []) names.set(c.id, c.function.name);
      const parts: Part[] = m.parts?.length ? m.parts : [
        ...(m.content ? [{ text: m.content }] : []),
        ...(m.tool_calls ?? []).map((c) => ({ functionCall: { id: c.id, name: c.function.name, args: JSON.parse(c.function.arguments || "{}") } })),
      ];
      contents.push({ role: "model", parts });
      continue;
    }
    let response: Record<string, unknown>;
    try {
      const parsed = JSON.parse(m.content ?? "{}");
      response = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { result: parsed };
    } catch {
      response = { result: m.content ?? "" };
    }
    const part: Part = { functionResponse: { id: m.tool_call_id, name: names.get(m.tool_call_id ?? "") ?? "tool", response } };
    const last = contents[contents.length - 1];
    if (last?.role === "user" && last.parts?.every((p) => p.functionResponse)) last.parts.push(part);
    else contents.push({ role: "user", parts: [part] });
  }
  return { system, contents };
}

/** One turn of a tool-calling conversation on Gemini (function calling). Throws on any failure. */
export async function chatTools(provider: ToolProvider, messages: ChatMsg[], tools: ToolSpec[], maxTokens = 700): Promise<{ message: ChatMsg; model: string }> {
  const model = env("LLM_CHAT_MODEL");
  const t = thinking("chat");
  const { system, contents } = toContents(messages);
  const r = await chatClient().models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: system || undefined, temperature: 0, maxOutputTokens: maxTokens + t.budget, thinkingConfig: t.config,
      tools: [{ functionDeclarations: tools.map((s) => ({ name: s.function.name, description: s.function.description, parametersJsonSchema: s.function.parameters })) }],
      httpOptions: { timeout: timeoutMs() },
    },
  });
  const parts = r.candidates?.[0]?.content?.parts ?? [];
  const calls: ToolCall[] = parts.filter((p) => p.functionCall).map((p, i) => ({
    id: p.functionCall!.id || `call_${Date.now().toString(36)}_${i}`,
    type: "function",
    function: { name: p.functionCall!.name ?? "", arguments: JSON.stringify(p.functionCall!.args ?? {}) },
  }));
  // keep the ids we assigned in the replayed parts so tool results match their calls
  let k = 0;
  const replay = parts.map((p) => (p.functionCall ? { ...p, functionCall: { ...p.functionCall, id: calls[k++].id } } : p));
  const content = textOf(parts);
  if (!calls.length && !content) throw new Error("empty reply");
  audit("concierge_turn", model, { tool_calls: calls.map((c) => c.function.name), content: content.slice(0, 300) }, model, provider);
  return { message: { role: "assistant", content, tool_calls: calls.length ? calls : undefined, parts: replay }, model };
}

// ---------------------------------------------------------------- health (AI status indicator)
export type ProviderState = "live" | "down" | "disabled" | "unconfigured";

export interface AiStatus {
  overall: "live" | "fallback" | "cache";
  mode: string;
  checkedAt: string;
  providers: { id: string; label: string; state: ProviderState; latencyMs?: number; model?: string; detail?: string }[];
  cachedAnswers: number;
}

let lastStatus: { at: number; value: AiStatus } | null = null;

/** Error text safe to show in the UI: short, and never anything that looks like a token. */
function safeError(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/(ya29|Bearer|sk)[-\w.]+/gi, "***").replace(/\s+/g, " ").slice(0, 160);
}

/** One tiny generation on the fast model. Cached for 30 s so the indicator can poll without load. */
export async function aiStatus(force = false): Promise<AiStatus> {
  if (!force && lastStatus && Date.now() - lastStatus.at < 30_000) return lastStatus.value;
  const chat = env("LLM_CHAT_MODEL"), fast = env("LLM_FAST_MODEL");
  const g: AiStatus["providers"][number] = {
    id: "vertex", label: "Gemini on Vertex AI", state: "unconfigured",
    model: [chat, fast].filter(Boolean).filter((m, i, a) => a.indexOf(m) === i).join(" + "),
  };
  if (env("LLM_DISABLE_VERTEX") === "true") g.state = "disabled";
  else if (vertexReady() && fast) {
    const t = Date.now();
    try {
      await chatClient().models.generateContent({
        model: fast, contents: "Reply with OK.",
        config: { maxOutputTokens: 8 + thinking("fast").budget, thinkingConfig: thinking("fast").config, httpOptions: { timeout: Math.min(8000, timeoutMs()) } },
      });
      Object.assign(g, { state: "live", latencyMs: Date.now() - t });
    } catch (e) {
      Object.assign(g, { state: "down", detail: safeError(e) });
    }
  }
  const mode = env("LLM_MODE", "live");
  let cachedAnswers = 0;
  try {
    cachedAnswers = get<{ n: number }>("SELECT COUNT(*) n FROM llm_cache")?.n ?? 0;
  } catch {
    /* DB not built */
  }
  const value: AiStatus = {
    overall: mode === "cache-first" ? "cache" : g.state === "live" ? "live" : "cache",
    mode, checkedAt: new Date().toISOString(), providers: [g], cachedAnswers,
  };
  lastStatus = { at: Date.now(), value };
  return value;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}
