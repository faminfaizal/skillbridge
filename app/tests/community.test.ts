// Community skills exchange, offline: requests are matched to consenting volunteers by skill and distance, an offer is
// a proposal, approval logs hours and a social row (no money), and reset leaves nothing.
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_DISABLE_VERTEX = "true";

const { get } = await import("../src/lib/db.ts");
const { data } = await import("../src/lib/engine/data.ts");
const { board, offer, postRequest, requestById, resetCommunity } = await import("../src/lib/engine/community.ts");
const { socialRows } = await import("../src/lib/engine/socialStore.ts");
const { decide } = await import("../src/lib/agents/inbox.ts");
const { resetAgents } = await import("../src/lib/agents/simulate.ts");

const impactCount = () => get<{ n: number }>("SELECT COUNT(*) n FROM impact_records")!.n;

after(async () => {
  await resetAgents();
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM community_requests")!.n, 0);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM volunteer_logs")!.n, 0);
  assert.equal(socialRows().length, 0);
});

test("the board lists the seeded requests with consenting, capable volunteers", async () => {
  await resetAgents();
  const m = data();
  const b = board();
  for (const id of ["SME-01", "SME-02", "SME-03", "SME-04", "SME-05"]) assert.ok(b.some((r) => r.id === id && r.status === "open" && r.hours === 8), id);
  for (const r of b) {
    assert.ok(r.matches.length <= 2);
    for (const v of r.matches) {
      const p = m.people.get(v.personId)!;
      assert.equal(p.consent_visibility, 1);
      assert.notEqual(p.level, "C");
      assert.ok(v.capability >= 0.6);
    }
  }
});

test("SME-02 (LoRaWAN, Cairns) gets a volunteer from the regional offices", () => {
  const r = requestById("SME-02")!;
  assert.equal(r.place, "Cairns");
  const top = r.matches[0];
  assert.ok(top, "a volunteer is matched");
  assert.ok(["Darwin", "Cairns"].includes(top.location), `nearby volunteer, got ${top.location}`);
  assert.ok(top.km < 2000);
});

test("offer then approve logs volunteer hours and a social row, with no money record", () => {
  const before = impactCount();
  const o = offer("SME-02");
  assert.ok(o.proposed && o.inboxId);
  assert.equal(requestById("SME-02")!.status, "offered");
  assert.equal(offer("SME-02").proposed, false, "no duplicate offer");
  const inbox = get<{ agent: string; kind: string; approver: string }>("SELECT agent, kind, approver FROM agent_inbox WHERE id = ?", o.inboxId!)!;
  assert.deepEqual([inbox.agent, inbox.kind, inbox.approver], ["people", "volunteer", "Community programme lead"]);
  decide(o.inboxId!, "approve");
  const log = get<{ person_id: string; hours: number }>("SELECT person_id, hours FROM volunteer_logs WHERE request_id = 'SME-02'")!;
  assert.equal(log.hours, 8);
  const social = socialRows().find((x) => x.ref === "SME-02")!;
  assert.equal(social.kind, "volunteer");
  assert.equal(social.volunteerHours, 8);
  assert.deepEqual(social.peopleIds, [log.person_id]);
  assert.equal(impactCount(), before, "volunteering is not money");
  assert.equal(requestById("SME-02")!.status, "approved");
});

test("a posted request is read offline, stored, clamped and offered", async () => {
  const r = await postRequest({ org: "Katherine Growers Co-op", text: "Help to set up soil moisture sensors on a LoRaWAN gateway at our farm near Katherine, about 100 hours." });
  assert.match(r.id, /^SIM-CR-\d+$/);
  assert.equal(r.place, "Katherine");
  assert.equal(r.hours, 40, "hours clamped to 40");
  assert.deepEqual(r.skills.map((s) => s.id), ["SK-lorawan"]);
  assert.equal(r.status, "offered");
  assert.ok(board().some((x) => x.id === r.id));
  assert.ok(resetCommunity() >= 1);
  assert.equal(requestById(r.id), null);
});
