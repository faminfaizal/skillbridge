// Document upload for My Profile: store the file, read its text (PDF via unpdf, DOCX via the built-in zip reader
// below, TXT as is), then suggest skills. Rules against the taxonomy always run; Gemini adds levels and skills
// the rules miss, and every AI skill must quote a sentence that is really in the document.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { get, run } from "../db.ts";
import { dbPath } from "../db.ts";
import { bumpDataVersion } from "../cacheVersion.ts";
import { data } from "../engine/data.ts";
import { aliasFor } from "../engine/infer.ts";
import { chatJson } from "../llm.ts";
import { ensureProfileTables } from "./tables.ts";
import { BadInput } from "./write.ts";

export const MAX_BYTES = 5 * 1024 * 1024;
export const DOC_KINDS = ["CV", "Certificate", "Portfolio", "Report"] as const;
const TYPES: Record<string, string> = { ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain" };

/** Minimal zip reader: returns one entry's bytes (stored or deflated). Enough for word/document.xml in a DOCX. */
export function zipEntry(buf: Buffer, name: string): Buffer | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      return method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? raw : null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function docxText(buf: Buffer): string {
  const xml = zipEntry(buf, "word/document.xml");
  if (!xml) throw new BadInput("This DOCX file could not be read. Save it again from Word, or upload a PDF.");
  return xml.toString("utf8").replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, " ").replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

async function pdfText(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

export async function readText(ext: string, buf: Buffer): Promise<string> {
  if (ext === ".pdf") return pdfText(buf);
  if (ext === ".docx") return docxText(buf);
  return buf.toString("utf8");
}

interface Suggestion { skillId: string; level: number; quote: string }

/** The sentence around the first alias match, trimmed for display. */
function quoteFor(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  if (!m) return null;
  const from = Math.max(0, text.lastIndexOf("\n", m.index), text.lastIndexOf(". ", m.index) + 1);
  let to = text.slice(m.index).search(/[.\n]/);
  to = to < 0 ? text.length : m.index + to + 1;
  return text.slice(from, to).replace(/\s+/g, " ").trim().slice(0, 220);
}

export function ruleSuggestions(text: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const s of data().skills.values()) {
    const q = quoteFor(text, aliasFor(s.name));
    if (q) out.push({ skillId: s.id, level: 3, quote: q });
  }
  return out;
}

const DOC_SYSTEM = `You read a staff member's document (CV, certificate, portfolio or report) and list the skills it shows.
Use ONLY skill names from the provided list. For each, give level 1 to 5 (1 learning, 3 can do it alone, 5 others come to them)
and a short exact quote from the document that shows it. Return JSON: {"skills":[{"name":"...","level":3,"quote":"..."}]}.`;

async function aiSuggestions(text: string): Promise<Suggestion[]> {
  const m = data();
  const names = [...m.skills.values()].map((s) => s.name).join("; ");
  const res = await chatJson<{ skills?: { name?: string; level?: number; quote?: string }[] }>("fast", DOC_SYSTEM,
    `Skills list: ${names}\n\nDocument:\n${text.slice(0, 6000)}`, { maxTokens: 700, kind: "profile-document" });
  const flat = text.replace(/\s+/g, " ").toLowerCase();
  const out: Suggestion[] = [];
  for (const s of res.data.skills ?? []) {
    const sk = s.name ? m.skillByName.get(s.name.toLowerCase()) : undefined;
    const quote = (s.quote ?? "").replace(/\s+/g, " ").trim();
    // Evidence check: the quote must really be in the document
    if (!sk || quote.length < 8 || !flat.includes(quote.toLowerCase().slice(0, 60))) continue;
    const level = Math.min(5, Math.max(1, Math.round(Number(s.level) || 3)));
    out.push({ skillId: sk.id, level, quote: quote.slice(0, 220) });
  }
  return out;
}

export async function uploadDocument(me: string, file: File, kind: string): Promise<{ message: string }> {
  ensureProfileTables();
  const ext = path.extname(file.name).toLowerCase();
  if (!TYPES[ext]) throw new BadInput("Upload a PDF, DOCX or TXT file.");
  if (file.size > MAX_BYTES) throw new BadInput("That file is over 5 MB. Upload a smaller copy.");
  if (file.size === 0) throw new BadInput("That file is empty.");
  if (!(DOC_KINDS as readonly string[]).includes(kind)) throw new BadInput("Choose what kind of document this is.");
  const buf = Buffer.from(await file.arrayBuffer());
  let text: string;
  try {
    text = await readText(ext, buf);
  } catch (e) {
    if (e instanceof BadInput) throw e;
    throw new BadInput("The text in this file could not be read. If it is a scanned image, upload a text PDF or DOCX.");
  }
  const id = `DOC-${crypto.randomUUID().slice(0, 8)}`;
  const dir = path.join(path.dirname(dbPath()), "uploads", me);
  fs.mkdirSync(dir, { recursive: true });
  const file_path = path.join(dir, `${id}${ext}`);
  fs.writeFileSync(file_path, buf);

  const found = new Map<string, Suggestion>();
  for (const s of ruleSuggestions(text)) found.set(s.skillId, s);
  let ai = "rules";
  if (text.trim().length > 40) {
    try {
      for (const s of await aiSuggestions(text)) found.set(s.skillId, { ...s, quote: s.quote || found.get(s.skillId)?.quote || "" });
      ai = "gemini";
    } catch {
      ai = "rules (AI limited)";
    }
  }
  run(`INSERT INTO profile_documents (id, person_id, filename, kind, mime, size, path, excerpt, ai, shared, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`, id, me, file.name.slice(0, 160), kind, TYPES[ext], file.size, file_path,
    text.replace(/\s+/g, " ").trim().slice(0, 600), ai, new Date().toISOString());
  for (const s of found.values()) run("INSERT INTO profile_doc_skills (doc_id, skill_id, level, quote, status) VALUES (?, ?, ?, ?, 'suggested')", id, s.skillId, s.level, s.quote);
  const summary = `Uploaded ${file.name}: ${found.size} skill${found.size === 1 ? "" : "s"} found${ai.startsWith("rules") ? " by matching the skills list" : ""}`;
  run("INSERT INTO profile_changes (person_id, actor_id, section, summary, at) VALUES (?, ?, 'documents', ?, ?)", me, me, summary, new Date().toISOString());
  bumpDataVersion();
  return { message: found.size ? summary : `Uploaded ${file.name}. No skills from the list were found in it.` };
}

export function documentPath(me: string, docId: string): { path: string; filename: string; mime: string } | undefined {
  ensureProfileTables();
  return get<{ path: string; filename: string; mime: string }>("SELECT path, filename, mime FROM profile_documents WHERE id = ? AND person_id = ?", docId, me);
}
