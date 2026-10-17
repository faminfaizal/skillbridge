// Gemini on Vertex AI smoke test through the app's own client (src/lib/llm.ts): chat, fast, embeddings, function calling.
// Usage (from app/): npm run smoke        Needs GOOGLE_CLOUD_PROJECT and ADC (gcloud auth application-default login).
import { chatJson, chatTools, embed, type ChatMsg, type ToolSpec } from "../src/lib/llm.ts";
import { env } from "../src/lib/env.ts";

process.env.LLM_MODE = "live";
let failed = 0;

async function check(name: string, fn: () => Promise<string>) {
  const t = Date.now();
  try {
    const out = await fn();
    console.log(`PASS  ${name.padEnd(8)} ${String(Date.now() - t).padStart(5)} ms  ${out}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name.padEnd(8)} ${(e as Error).message.slice(0, 300)}`);
  }
}

console.log(`project ${env("GOOGLE_CLOUD_PROJECT") || "(unset)"} | chat ${env("LLM_CHAT_MODEL") || "(unset)"} | fast ${env("LLM_FAST_MODEL") || "(unset)"} | embed ${env("LLM_EMBED_MODEL", "gemini-embedding-001")}`);
const nonce = Date.now();

for (const role of ["chat", "fast"] as const) {
  await check(role, async () => {
    const r = await chatJson<{ capital?: string }>(role, "Return ONLY JSON.", `{"q":"Capital of France as {\\"capital\\": string}","n":${nonce}}`);
    if (r.provider !== "vertex") throw new Error(`served by ${r.provider}`);
    if (!/paris/i.test(r.data.capital ?? "")) throw new Error(`unexpected ${JSON.stringify(r.data)}`);
    return `${r.model}: ${JSON.stringify(r.data)}`;
  });
}

await check("embed", async () => {
  const [a, b, c] = await embed(["Kubernetes cluster operations", "container orchestration", "payroll accounting"]);
  const cos = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0) / Math.sqrt(x.reduce((s, v) => s + v * v, 0) * y.reduce((s, v) => s + v * v, 0));
  if (!(cos(a, b) > cos(a, c))) throw new Error("similar texts are not closer than unrelated ones");
  return `${a.length} dims, related ${cos(a, b).toFixed(3)} > unrelated ${cos(a, c).toFixed(3)}`;
});

await check("tools", async () => {
  const tools: ToolSpec[] = [{ type: "function", function: { name: "headcount", description: "Number of people in a team.",
    parameters: { type: "object", properties: { team: { type: "string" } }, required: ["team"] } } }];
  const messages: ChatMsg[] = [{ role: "system", content: "Use the tools to answer. Reply in one short sentence." }, { role: "user", content: "How many people are in the Data Science team?" }];
  const first = await chatTools("vertex", messages, tools);
  const call = first.message.tool_calls?.[0];
  if (!call || call.function.name !== "headcount") throw new Error(`no tool call: ${first.message.content}`);
  messages.push(first.message, { role: "tool", tool_call_id: call.id, content: JSON.stringify({ team: "Data Science", people: 17 }) });
  const second = await chatTools("vertex", messages, tools);
  if (!/17/.test(second.message.content ?? "")) throw new Error(`answer ignored the tool result: ${second.message.content}`);
  return `${first.model}: called headcount(${call.function.arguments}), answered "${second.message.content}"`;
});

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
