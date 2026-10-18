"use client";
// Community skills exchange: local requests (seeded and posted) matched to consenting volunteers by skill and distance.
// The People Growth agent offers the best volunteer; the community programme lead approves; hours go to the social ledger.
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { IntakeForm, intakeForm, type IntakeValue } from "./IntakeForm";
import type { ActPanelProps } from "./actPanels";
import type { CommunityRequest } from "../lib/engine/community";

const STATUS: Record<CommunityRequest["status"], string> = { open: "Open", offered: "Offer waiting", approved: "Volunteering logged", dismissed: "Dismissed" };
const num = (n: number) => n.toLocaleString("en-US");

export default function CommunityPanel({ onFocus, onShow, onAgents, onToast, refreshAgents }: ActPanelProps) {
  const [requests, setRequests] = useState<CommunityRequest[] | null>(null);
  const [err, setErr] = useState("");
  const [posting, setPosting] = useState(false);
  const [showPost, setShowPost] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  function show(r: CommunityRequest) {
    setActive(r.id);
    const people = r.matches.slice(0, 3).map((v) => v.personId);
    onShow({ nodeIds: [...people, ...r.skills.map((s) => s.id)], stars: people.slice(0, 1), pulse: people });
  }

  async function load() {
    try {
      const r = await fetch("/api/community");
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setRequests(b.requests);
    } catch (e) {
      setErr(`Could not load the request board: ${(e as Error).message}`);
    }
  }
  useEffect(() => { void load(); }, []);

  async function post(v: IntakeValue) {
    setPosting(true);
    setErr("");
    try {
      const r = await fetch("/api/community", { method: "POST", body: intakeForm(v) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "The request could not be read.");
      setRequests(b.requests);
      setShowPost(false);
      show(b.request);
      refreshAgents();
      onToast(b.request.matches.length ? `${b.request.org}: ${b.request.matches[0].name} offered, waiting for approval.` : `${b.request.org}: posted; no volunteer matches yet.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPosting(false);
    }
  }

  async function offer(r: CommunityRequest) {
    setWorking(r.id);
    try {
      const res = await fetch(`/api/community/${encodeURIComponent(r.id)}/offer`, { method: "POST" });
      const b = await res.json();
      setRequests(b.requests ?? requests);
      onToast(b.message ?? b.error ?? "Done.");
      refreshAgents();
    } catch (e) {
      onToast(`Could not offer: ${(e as Error).message}`);
    } finally {
      setWorking(null);
    }
  }

  async function decide(r: CommunityRequest, decision: "approve" | "dismiss") {
    if (!r.inboxId) return;
    setWorking(r.id);
    try {
      const res = await fetch(`/api/agents/inbox/${r.inboxId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error);
      onToast(b.outcome);
      await load();
      refreshAgents();
    } catch (e) {
      onToast(`Could not record the decision: ${(e as Error).message}`);
    } finally {
      setWorking(null);
    }
  }

  const logged = requests?.filter((r) => r.status === "approved").reduce((a, r) => a + r.hours, 0) ?? 0;
  return (
    <div className="panel-body">
      <div className="eyebrow"><Icon name="hand" /> Act</div>
      <h2 className="panel-title">Community skills exchange</h2>
      <p className="muted small">Local organisations ask for skills; SkillBridge matches consenting colleagues by capability and distance. People decide: every offer waits for approval.</p>

      <div className="community-bar">
        <span className="small muted">{requests ? `${requests.length} requests` : "Loading..."}{logged ? ` · ${num(logged)} h logged` : ""}</span>
        <button className="btn small" aria-expanded={showPost} onClick={() => setShowPost(!showPost)}><Icon name="plus" />Post a request</button>
      </div>
      {showPost && (
        <IntakeForm withOrg label="What help is needed?" placeholder="For example: Our farm co-op near Katherine needs help setting up LoRaWAN soil sensors, about 12 hours."
          submitLabel="Post and match" busy={posting} onSubmit={(v) => void post(v)} />
      )}
      {err && <p className="intake-err small" role="alert">{err}</p>}

      <ul className="community-list">
        {requests?.map((r) => {
          const v = r.matches[0];
          const busy = working === r.id;
          return (
            <li key={r.id} className={`card community-req ${active === r.id ? "active" : ""}`}>
              <button className="community-req-h" onClick={() => show(r)} aria-pressed={active === r.id}>
                <strong>{r.org}</strong>
                <span className={`chip community-status community-${r.status}`}>{STATUS[r.status]}</span>
              </button>
              <p className="small">{r.need}</p>
              <div className="chips">
                <span className="chip">{r.place}</span>
                {r.remote && <span className="chip chip-remote">Remote region</span>}
                <span className="chip">{r.hours} h</span>
                {r.skills.map((s) => <button key={s.id} className="chip chip-btn" onClick={() => onFocus(s.id)}>{s.name}</button>)}
              </div>
              {v ? (
                <p className="small community-match">
                  <Icon name="user" /> Best match: <button className="link-btn" onClick={() => onFocus(v.personId)}>{v.name}</button>
                  <span className="muted"> {v.title}, {v.location}: {v.mode === "flight" ? "remote help" : `${num(v.km)} km by ${v.mode}`}, capability {Math.round(v.capability * 100)}%, {v.availabilityPct}% free</span>
                  {r.matches.length > 1 && <span className="muted"> (+{r.matches.length - 1} more)</span>}
                </p>
              ) : <p className="small muted">No consenting volunteer with this skill is available.</p>}
              {r.privateCount > 0 && <p className="small muted"><Icon name="lock" /> {r.privateCount} qualified {r.privateCount === 1 ? "person" : "people"} private: counted, not named.</p>}
              <div className="community-actions">
                {r.status === "open" && v && <button className="btn small" onClick={() => void offer(r)} disabled={busy}><Icon name="hand" />Offer volunteer</button>}
                {r.status === "offered" && r.inboxId && (
                  <>
                    <button className="btn small btn-approve" onClick={() => void decide(r, "approve")} disabled={busy}><Icon name="check" />Approve</button>
                    <button className="btn small btn-ghost" onClick={() => void decide(r, "dismiss")} disabled={busy}>Dismiss</button>
                  </>
                )}
                {r.status === "offered" && <button className="btn small btn-ghost" onClick={onAgents}><Icon name="inbox" />Inbox</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
