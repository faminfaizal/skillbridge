// The AI step every downstream agent shares: draft the human-facing note from engine facts. Template fallback,
// house style (no em/en dashes), cached by the LLM client like every other call.
import { chatJson } from "../llm.ts";

export async function draft(system: string, facts: Record<string, unknown>, fallback: string): Promise<{ text: string; provider: string }> {
  try {
    const r = await chatJson<{ note: string }>("fast", `${system} Use only the facts given and their exact figures; never invent names, numbers or field names. Return ONLY JSON: {"note": string}.`,
      JSON.stringify(facts), { kind: "agent_draft", maxTokens: 260 });
    const text = r.data.note?.replace(/\s*[–—]\s*/g, ", ").trim();
    if (text && text.length > 30) return { text, provider: r.provider };
  } catch {
    /* template below */
  }
  return { text: fallback, provider: "template" };
}
