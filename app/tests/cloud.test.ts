// Google Cloud layer, offline: hooks are no-ops under the test runner even with CLOUD_SYNC=on, Firestore values
// round-trip, the Pub/Sub push endpoint rejects bad tokens, and the SQLite fallbacks (ledger, quarters) match the data.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_DISABLE_VERTEX = "true";
process.env.LLM_MODE = "cache-first";
process.env.CLOUD_SYNC = "on"; // still off: the test runner sets NODE_TEST_CONTEXT
process.env.PUSH_TOKEN = "test-push-token-0123456789";
process.env.GOOGLE_CLOUD_PROJECT ||= "test-project-01";

const cloud = await import("../src/lib/cloud/index.ts");
const { encodeValue, decodeValue, encodeFields, decodeFields, docId } = await import("../src/lib/cloud/firestore.ts");
const { handlePush, parseEnvelope, tokenOk } = await import("../src/lib/cloud/push.ts");
const { ledgerView, valueQuarters } = await import("../src/lib/cloud/ledger.ts");
const { replaceScript } = await import("../src/lib/cloud/bigquery.ts");
const { cloudStatus } = await import("../src/lib/cloud/status.ts");
const { all, get } = await import("../src/lib/db.ts");

const envelope = (data: object, publishTime = new Date(Date.now() - 250).toISOString()) => JSON.stringify({
  message: { data: Buffer.from(JSON.stringify(data)).toString("base64"), attributes: { kind: "simulate" }, messageId: "m-1", publishTime },
  subscription: "projects/p/subscriptions/s",
});

test("cloud hooks are no-ops when off and under the test runner", async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, "running under node --test");
  assert.equal(cloud.cloudOn(), false);
  assert.equal(cloud.ledgerChanged("test"), undefined);
  assert.equal(cloud.agentsChanged("test"), undefined);
  assert.equal(cloud.mirror("crises", "C-1", { a: 1 }), undefined);
  const t = Date.now();
  assert.equal(await cloud.publishEvent("simulate", { x: 1 }), false);
  assert.ok(Date.now() - t < 100, "publishEvent returns at once when off");
  await new Promise((r) => setTimeout(r, 30));
  const sync = (globalThis as unknown as { __sbSync?: { ledger: { timer: unknown }; agents: { timer: unknown } } }).__sbSync;
  assert.ok(!sync || (sync.ledger.timer === null && sync.agents.timer === null), "no sync scheduled");
  const s = cloudStatus();
  assert.equal(s.on, false);
  assert.deepEqual([s.firestore.state, s.bigquery.state, s.pubsub.state], ["off", "off", "off"]);
});

test("Firestore values round-trip: strings, integers, doubles, booleans, null, timestamps, arrays, maps", () => {
  const at = new Date("2026-10-18T04:00:00.123Z");
  const doc = { s: "IMP-001", i: 42, neg: -7, d: 0.85, b: false, n: null, at, arr: [1, "two", 3.5, [true]], map: { a: { b: [at] } }, empty: [], none: {} };
  const f = encodeFields(doc);
  assert.deepEqual(f.i, { integerValue: "42" });
  assert.deepEqual(f.d, { doubleValue: 0.85 });
  assert.deepEqual(f.at, { timestampValue: "2026-10-18T04:00:00.123Z" });
  assert.deepEqual(decodeFields(JSON.parse(JSON.stringify(f))), doc, "survives the JSON wire format");
  assert.deepEqual(encodeValue(Number.NaN), { nullValue: null });
  assert.equal("skip" in encodeFields({ skip: undefined }), false);
  assert.equal(decodeValue({ integerValue: "9007199254740991" }), Number.MAX_SAFE_INTEGER);
  assert.equal(docId("a/b c"), "a_b_c");
  assert.equal(docId("__id__"), "_id_");
});

test("Pub/Sub push: bad or missing token is rejected with 403; a valid push is recorded with its lag", async () => {
  const req = (url: string, body: string, headers: Record<string, string> = {}) => new Request(url, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
  assert.equal(tokenOk("x", ""), false, "no token configured means no access");
  assert.equal(tokenOk("test-push-token-012345678"), false);
  assert.equal((await handlePush(req("http://h/api/events/push", envelope({ kind: "simulate" })))).status, 403);
  assert.equal((await handlePush(req("http://h/api/events/push?token=wrong", envelope({ kind: "simulate" })))).status, 403);
  const { POST } = await import("../src/app/api/events/push/route.ts");
  assert.equal((await POST(req("http://h/api/events/push?token=nope", envelope({})))).status, 403, "the route rejects too");
  assert.equal((await handlePush(req("http://h/api/events/push?token=test-push-token-0123456789", "not json"))).status, 400);
  const ok = await handlePush(req("http://h/api/events/push", envelope({ kind: "simulate", scenario: "rfp" }), { "x-sync-token": "test-push-token-0123456789" }));
  assert.equal(ok.status, 204);
  assert.equal(ok.event?.kind, "simulate");
  assert.equal(ok.event?.payload?.scenario, "rfp");
  assert.ok(ok.event!.lagMs! >= 200 && ok.event!.lagMs! < 5000, `lag ${ok.event?.lagMs}`);
  assert.ok(cloudStatus().pubsub.pushes >= 1);
  assert.equal(parseEnvelope({ nope: 1 }), null);
});

test("value by quarter falls back to SQLite and sums exactly to impact_records", async () => {
  const q = await valueQuarters();
  assert.equal(q.source, "sqlite");
  const total = get<{ n: number; v: number }>("SELECT COUNT(*) n, SUM(cost_avoided_amt + productivity_amt + recruitment_amt + revenue_amt) v FROM impact_records")!;
  assert.equal(q.rows.reduce((a, r) => a + r.activations, 0), total.n);
  assert.equal(q.rows.reduce((a, r) => a + r.value, 0), total.v);
  for (const r of q.rows) assert.match(r.quarter, /^\d{4} Q[1-4]$/);
  assert.deepEqual(q.rows.map((r) => r.quarter), [...q.rows.map((r) => r.quarter)].sort(), "ordered by quarter");
});

test("public ledger falls back to SQLite, matches the totals and never carries person ids", async () => {
  const v = await ledgerView();
  assert.equal(v.source, "sqlite");
  const rows = all<{ id: string }>("SELECT id FROM impact_records");
  assert.equal(v.records.length, rows.length);
  assert.equal(v.totals.total, v.records.reduce((a, r) => a + r.cost_avoided_amt + r.productivity_amt + r.recruitment_amt + r.revenue_amt, 0));
  for (const r of v.records) assert.equal("person_ids" in r, false);
});

test("BigQuery replace script takes the rows as one parameter, never as SQL text", () => {
  const sql = replaceScript("impact_records");
  assert.match(sql, /^TRUNCATE TABLE `[\w-]+\.\w+\.impact_records`;/);
  assert.match(sql, /UNNEST\(JSON_QUERY_ARRAY\(@rows\)\)/);
  assert.match(sql, /SAFE_CAST\(JSON_VALUE\(r, '\$\.people_count'\) AS INT64\)/);
  assert.match(sql, /CURRENT_TIMESTAMP\(\)/);
  assert.doesNotMatch(sql, /IMP-\d/);
});
