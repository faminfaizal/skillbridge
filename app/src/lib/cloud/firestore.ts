// Firestore over REST (Native mode, "(default)" database): typed value encoding, get, patch, list and batched commits.
// Used only for mirrors and session memory; SQLite stays the source of truth.
import { gcpRequest, projectId } from "./gcp.ts";

export type FsValue =
  | { nullValue: null } | { booleanValue: boolean } | { integerValue: string } | { doubleValue: number }
  | { timestampValue: string } | { stringValue: string } | { arrayValue: { values?: FsValue[] } } | { mapValue: { fields?: Record<string, FsValue> } };
export type FsFields = Record<string, FsValue>;
export interface FsDoc { name: string; fields?: FsFields; updateTime?: string }
export type Write = { update: { path: string; data: Record<string, unknown> } } | { delete: string };

const root = () => `projects/${projectId()}/databases/(default)/documents`;
const base = () => `https://firestore.googleapis.com/v1/${root()}`;
/** A safe document id: Firestore forbids "/" and the reserved "__x__" form. */
export const docId = (id: string) => id.replace(/[/\s]+/g, "_").replace(/^__(.*)__$/, "_$1_").slice(0, 500) || "_";
const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

// ---------------------------------------------------------------- values
export function encodeValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "bigint") return { integerValue: v.toString() };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { nullValue: null };
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === "object") return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } };
  return { stringValue: String(v) };
}

export function encodeFields(o: Record<string, unknown>): FsFields {
  const out: FsFields = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = encodeValue(v);
  return out;
}

export function decodeValue(v: FsValue): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decodeValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields ?? {});
  return null;
}

export function decodeFields(f: FsFields): Record<string, unknown> {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decodeValue(v)]));
}

// ---------------------------------------------------------------- documents
/** One document, or null when it does not exist. */
export async function fsGet(path: string, timeoutMs = 2500): Promise<Record<string, unknown> | null> {
  try {
    const d = await gcpRequest<FsDoc>(`${base()}/${enc(path)}`, { timeoutMs });
    return decodeFields(d.fields ?? {});
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/** Create or fully replace one document. */
export async function fsPatch(path: string, data: Record<string, unknown>, timeoutMs = 4000): Promise<void> {
  await gcpRequest(`${base()}/${enc(path)}`, { method: "PATCH", data: { fields: encodeFields(data) }, timeoutMs });
}

/** Every document id and body in a collection (paged). */
export async function fsList(collection: string, timeoutMs = 4000): Promise<{ id: string; data: Record<string, unknown>; updateTime?: string }[]> {
  const out: { id: string; data: Record<string, unknown>; updateTime?: string }[] = [];
  let token = "";
  for (let page = 0; page < 20; page++) {
    const r = await gcpRequest<{ documents?: FsDoc[]; nextPageToken?: string }>(
      `${base()}/${enc(collection)}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, { timeoutMs });
    for (const d of r.documents ?? []) out.push({ id: d.name.slice(d.name.lastIndexOf("/") + 1), data: decodeFields(d.fields ?? {}), updateTime: d.updateTime });
    if (!r.nextPageToken) break;
    token = r.nextPageToken;
  }
  return out;
}

/** Batched writes (full-replace updates and deletes), at most 500 per commit as Firestore requires. */
export async function fsCommit(writes: Write[], timeoutMs = 5000): Promise<number> {
  for (let i = 0; i < writes.length; i += 500) {
    const chunk = writes.slice(i, i + 500).map((w) => ("delete" in w
      ? { delete: `${root()}/${w.delete}` }
      : { update: { name: `${root()}/${w.update.path}`, fields: encodeFields(w.update.data) } }));
    await gcpRequest(`${base()}:commit`, { method: "POST", data: { writes: chunk }, timeoutMs });
  }
  return writes.length;
}

/** Replace a whole collection: write every doc given and delete the ones that are no longer there. */
export async function fsReplaceCollection(collection: string, docs: { id: string; data: Record<string, unknown> }[]): Promise<{ written: number; deleted: number }> {
  const keep = new Set(docs.map((d) => docId(d.id)));
  const existing = await fsList(collection);
  const stale = existing.filter((d) => !keep.has(d.id)).map((d) => `${collection}/${d.id}`);
  await fsCommit([
    ...docs.map((d) => ({ update: { path: `${collection}/${docId(d.id)}`, data: d.data } })),
    ...stale.map((p) => ({ delete: p })),
  ]);
  return { written: docs.length, deleted: stale.length };
}
