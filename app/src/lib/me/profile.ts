// Read side of My Profile: one bundle with everything the tabs need, prefilled from ERA (people), project systems,
// work evidence and the person's own entries.
import { all, get } from "../db.ts";
import { data } from "../engine/data.ts";
import { supportingEvidence } from "../engine/infer.ts";
import { growthPaths } from "../engine/growth.ts";
import { ensureProfileTables } from "./tables.ts";
import { DEFAULT_AUDIENCE, type Audience, type ProfileBundle, type TabId } from "./types.ts";

const json = <T>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

export const RECOGNITION_PROMPTS = [
  "Who helped your team succeed?",
  "Who solved problems others could not?",
  "Who made a meaningful contribution?",
  "Who went beyond their formal role?",
  "Who was dependable during issues?",
  "Whose work materially affected the outcome?",
];

export function profileBundle(id: string): ProfileBundle | null {
  ensureProfileTables();
  const m = data();
  const p = m.people.get(id);
  if (!p) return null;
  const name = (pid: string | null | undefined) => (pid ? m.people.get(pid)?.name ?? pid : "");
  const skillName = (sid: string) => m.skills.get(sid)?.name ?? sid;
  const division = get<{ name: string }>("SELECT name FROM divisions WHERE id = ?", p.division_id)?.name ?? "";
  const manager = p.manager_id ? m.people.get(p.manager_id) : undefined;
  const reports = all<{ id: string; name: string; title: string }>("SELECT id, name, title FROM people WHERE manager_id = ? ORDER BY name", id);

  // About
  const ab = get<{ headline: string; bio: string; languages: string; location_pref: string }>("SELECT * FROM profile_about WHERE person_id = ?", id);
  const seedProfile = get<{ cv_summary: string }>("SELECT cv_summary FROM profiles WHERE person_id = ?", id);
  const about = { headline: ab?.headline ?? "", bio: ab?.bio ?? seedProfile?.cv_summary ?? "", languages: json<string[]>(ab?.languages, []), locationPref: ab?.location_pref ?? "" };

  // Projects
  const hidden = new Set(all<{ kind: string; ref_id: string }>("SELECT kind, ref_id FROM profile_hidden WHERE person_id = ?", id).map((h) => `${h.kind}:${h.ref_id}`));
  const system = (m.assignments.get(id) ?? []).map((a) => {
    const pr = m.projects.get(a.project_id);
    return { assignmentId: a.id, projectId: a.project_id, name: pr?.name ?? a.project_id, role: a.role, start: a.start_date, end: a.end_date,
      manDays: a.man_days, status: pr?.status ?? "", note: a.contribution_note, hidden: hidden.has(`project:${a.project_id}`), self: a.id.startsWith("SELF-") };
  }).sort((x, y) => y.end.localeCompare(x.end));
  const own = all<Record<string, any>>("SELECT * FROM profile_projects WHERE person_id = ? ORDER BY start_month DESC, created_at DESC", id).map((r) => ({
    id: r.id, name: r.name, type: r.type, role: r.role, start: r.start_month, end: r.end_month, effort: r.effort, contribution: r.contribution,
    skills: json<string[]>(r.skills, []).map((s) => ({ id: s, name: skillName(s) })), link: r.link, status: r.status,
    decidedBy: r.decided_by ? name(r.decided_by) : null, declineNote: r.decline_note,
  }));

  // Skills
  const evRows = m.evidence.get(id) ?? [];
  const ownEvidence = all<Record<string, any>>("SELECT * FROM profile_evidence WHERE person_id = ? ORDER BY date DESC", id);
  const meta = new Map(all<{ skill_id: string; want_grow: number }>("SELECT skill_id, want_grow FROM profile_skill_meta WHERE person_id = ?", id).map((r) => [r.skill_id, r.want_grow === 1]));
  const validations = new Map(all<{ skill_id: string; status: string }>("SELECT skill_id, status FROM profile_validations WHERE person_id = ?", id).map((r) => [r.skill_id, r.status]));
  const declared = [...(m.declared.get(id)?.values() ?? [])];
  const skills = declared.map((d) => {
    const s = m.skills.get(d.skill_id);
    return { skillId: d.skill_id, name: s?.name ?? d.skill_id, family: s?.family ?? "", level: d.level, source: d.source, year: d.last_used_year,
      wantGrow: meta.get(d.skill_id) ?? false, validation: (validations.get(d.skill_id) ?? null) as ProfileBundle["skills"][number]["validation"],
      evidence: (s ? supportingEvidence(evRows, s.name).length : 0) + ownEvidence.filter((e) => e.skill_id === d.skill_id).length };
  }).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  const have = new Set(declared.map((d) => d.skill_id));
  const growOnly = [...meta.entries()].filter(([s, w]) => w && !have.has(s)).map(([s]) => ({ id: s, name: skillName(s) }));

  const suggested: ProfileBundle["suggested"] = [];
  for (const a of m.assignments.get(id) ?? []) {
    for (const sid of m.projectSkills.get(a.project_id) ?? []) {
      if (have.has(sid) || suggested.some((x) => x.skillId === sid)) continue;
      suggested.push({ skillId: sid, name: skillName(sid), reason: `Used on ${m.projects.get(a.project_id)?.name ?? a.project_id}` });
    }
  }

  // Evidence
  const refLabel = (kind: string, ref: string | null) => {
    if (!ref) return "";
    if (kind === "project") return m.projects.get(ref)?.name ?? ref;
    if (kind === "knowledge") return get<{ title: string }>("SELECT title FROM knowledge_items WHERE id = ?", ref)?.title ?? ref;
    if (kind === "incident") return get<{ code: string }>("SELECT code FROM incidents WHERE id = ?", ref)?.code ?? ref;
    if (kind === "document") return get<{ filename: string }>("SELECT filename FROM profile_documents WHERE id = ?", ref)?.filename ?? ref;
    if (kind === "certification") return get<{ name: string }>("SELECT name FROM certifications WHERE id = ?", ref)?.name ?? ref;
    return ref;
  };
  const evidence = {
    auto: [...evRows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map((e) => ({ id: e.id, kind: e.kind, text: e.text, date: e.date })),
    own: ownEvidence.map((e) => ({ id: e.id, skillId: e.skill_id, skill: skillName(e.skill_id), kind: e.kind, refId: e.ref_id, refLabel: refLabel(e.kind, e.ref_id),
      note: e.note, date: e.date, hidden: e.hidden === 1 })),
  };

  // Documents
  const documents = all<Record<string, any>>("SELECT * FROM profile_documents WHERE person_id = ? ORDER BY uploaded_at DESC", id).map((d) => ({
    id: d.id, filename: d.filename, kind: d.kind, size: d.size, uploadedAt: d.uploaded_at, ai: d.ai, shared: d.shared === 1,
    suggestions: all<Record<string, any>>("SELECT * FROM profile_doc_skills WHERE doc_id = ? ORDER BY level DESC", d.id).map((s) => ({
      skillId: s.skill_id, name: skillName(s.skill_id), level: s.level, quote: s.quote, status: s.status, have: have.has(s.skill_id) })),
  }));

  // Certifications
  const certs = {
    era: all<{ cert_id: string; name: string; skill_id: string; year: number }>(
      "SELECT pc.cert_id, c.name, c.skill_id, pc.year FROM person_certs pc JOIN certifications c ON c.id = pc.cert_id WHERE pc.person_id = ? ORDER BY pc.year DESC", id)
      .map((c) => ({ certId: c.cert_id, name: c.name, skill: skillName(c.skill_id), year: c.year,
        self: !!get("SELECT 1 FROM profile_trace WHERE tbl = 'person_certs' AND key = ? AND original IS NULL", JSON.stringify([id, c.cert_id])) })),
    own: all<Record<string, any>>("SELECT * FROM profile_certs WHERE person_id = ? ORDER BY issued DESC", id)
      .map((c) => ({ id: c.id, name: c.name, issuer: c.issuer, issued: c.issued, expiry: c.expiry })),
  };

  // Connections
  const workedWith = all<{ id: string; n: number }>(
    `SELECT b.person_id id, COUNT(DISTINCT b.project_id) n FROM assignments a JOIN assignments b ON a.project_id = b.project_id AND b.person_id <> a.person_id
     WHERE a.person_id = ? GROUP BY b.person_id ORDER BY n DESC LIMIT 12`, id)
    .map((r) => ({ id: r.id, name: name(r.id), title: m.people.get(r.id)?.title ?? "", shared: r.n }));
  const connections = {
    workedWith,
    own: all<Record<string, any>>("SELECT * FROM profile_connections WHERE person_id = ? ORDER BY created_at DESC", id).map((c) => ({
      id: c.id, otherId: c.other_id, name: name(c.other_id), title: m.people.get(c.other_id)?.title ?? "", kind: c.kind, skill: c.skill_id ? skillName(c.skill_id) : null })),
  };

  // Peer feedback
  const fbByRec = new Map(all<Record<string, any>>("SELECT * FROM profile_feedback WHERE to_id = ?", id).map((f) => [f.rec_id, f]));
  const feedback = {
    received: all<{ id: string; from_id: string; question: string; project_id: string | null; date: string }>(
      "SELECT * FROM peer_recognition WHERE to_id = ? ORDER BY date DESC", id).map((r) => {
      const f = fbByRec.get(r.id);
      return { id: r.id, from: name(r.from_id), question: r.question, project: r.project_id ? m.projects.get(r.project_id)?.name ?? null : null, date: r.date,
        text: f?.text ?? "", hidden: hidden.has(`recognition:${r.id}`), thanked: f?.thanked === 1, feedbackId: f?.id ?? null };
    }),
    given: all<Record<string, any>>(
      "SELECT f.*, r.question FROM profile_feedback f LEFT JOIN peer_recognition r ON r.id = f.rec_id WHERE f.from_id = ? ORDER BY f.created_at DESC", id)
      .map((f) => ({ id: f.id, to: name(f.to_id), question: f.question ?? "", text: f.text, date: f.created_at.slice(0, 10) })),
    requests: all<Record<string, any>>("SELECT * FROM profile_feedback_requests WHERE to_id = ? AND status = 'open' ORDER BY created_at DESC", id)
      .map((q) => ({ id: q.id, fromId: q.from_id, from: name(q.from_id), project: q.project_id ? m.projects.get(q.project_id)?.name ?? null : null, date: q.created_at.slice(0, 10) })),
    prompts: RECOGNITION_PROMPTS,
  };

  // AI suggestions: inferred skills not on the profile and not yet decided
  const decided = new Set(all<{ skill_id: string }>("SELECT skill_id FROM profile_suggestion_decisions WHERE person_id = ?", id).map((r) => r.skill_id));
  const evById = new Map(evRows.map((e) => [e.id, e]));
  const suggestions = [...(m.inferred.get(id)?.values() ?? [])].filter((i) => !have.has(i.skill_id) && !decided.has(i.skill_id)).map((i) => ({
    skillId: i.skill_id, name: skillName(i.skill_id), confidence: i.confidence, rationale: i.rationale,
    evidence: i.evidence_ids.split(",").map((e) => evById.get(e)).filter(Boolean).map((e) => ({ kind: e!.kind, text: e!.text, date: e!.date })),
  })).sort((a, b) => b.confidence - a.confidence);

  // Growth, availability, privacy
  const g = get<{ interests: string; goals: string; target_roles: string }>("SELECT * FROM profile_growth WHERE person_id = ?", id);
  const seedInterests = get<{ interests: string }>("SELECT interests FROM profiles WHERE person_id = ?", id)?.interests;
  const growth = {
    interests: g ? json<string[]>(g.interests, []) : (seedInterests ? seedInterests.split(",").map((s) => s.trim()).filter(Boolean) : []),
    goals: g?.goals ?? "", targetRoles: json<string[]>(g?.target_roles, []), paths: growthPaths(id),
  };
  const av = get<Record<string, any>>("SELECT * FROM profile_availability WHERE person_id = ?", id);
  const availability = { pct: p.availability_pct, openProjects: av?.open_projects === 1, openSme: av?.open_sme === 1, openMentoring: av?.open_mentoring === 1, until: av?.until ?? "" };
  const sections: Record<string, Audience> = { ...DEFAULT_AUDIENCE } as Record<string, Audience>;
  for (const r of all<{ section: string; audience: Audience }>("SELECT section, audience FROM profile_privacy WHERE person_id = ?", id)) sections[r.section] = r.audience;

  // History, reports, impact
  const history = all<{ at: string; actor_id: string; section: string; summary: string }>("SELECT * FROM profile_changes WHERE person_id = ? ORDER BY id DESC LIMIT 60", id)
    .map((h) => ({ at: h.at, actor: h.actor_id === id ? "You" : name(h.actor_id), section: h.section, summary: h.summary }));
  const reportRows = all<Record<string, any>>("SELECT * FROM profile_reports WHERE person_id = ? ORDER BY created_at DESC", id)
    .map((r) => ({ id: r.id, kind: r.kind, target: r.target, message: r.message, status: r.status, date: r.created_at.slice(0, 10) }));
  const imp = all<{ id: string; date: string; title: string; v: number; person_ids: string | null }>(
    "SELECT id, date, title, cost_avoided_amt + productivity_amt + recruitment_amt + revenue_amt v, person_ids FROM impact_records ORDER BY date DESC")
    .filter((r) => (r.person_ids ?? "").split(",").includes(id));
  const impact = {
    valueAmt: imp.reduce((s, r) => s + r.v, 0), records: imp.map((r) => ({ id: r.id, date: r.date, title: r.title, valueAmt: r.v })),
    recognition: feedback.received.length, incidents: get<{ n: number }>("SELECT COUNT(*) n FROM incident_resolvers WHERE person_id = ?", id)?.n ?? 0,
    projects: system.length, knowledge: all<{ title: string; reuse: number }>("SELECT title, reuse_count reuse FROM knowledge_items WHERE author_id = ? ORDER BY reuse_count DESC", id),
  };

  // Manager: pending items from direct reports
  let team: ProfileBundle["team"] = null;
  if (reports.length) {
    const ids = reports.map((r) => r.id);
    const ph = ids.map(() => "?").join(",");
    team = {
      reports,
      projects: all<Record<string, any>>(`SELECT * FROM profile_projects WHERE status = 'pending' AND person_id IN (${ph}) ORDER BY created_at`, ...ids).map((r) => ({
        id: r.id, personId: r.person_id, person: name(r.person_id), name: r.name, type: r.type, role: r.role, start: r.start_month, end: r.end_month,
        effort: r.effort, contribution: r.contribution, skills: json<string[]>(r.skills, []).map(skillName) })),
      skills: all<{ person_id: string; skill_id: string; created_at: string }>(`SELECT * FROM profile_validations WHERE status = 'pending' AND person_id IN (${ph}) ORDER BY created_at`, ...ids)
        .map((v) => {
          const d = m.declared.get(v.person_id)?.get(v.skill_id);
          const s = m.skills.get(v.skill_id);
          return { personId: v.person_id, person: name(v.person_id), skillId: v.skill_id, skill: s?.name ?? v.skill_id, level: d?.level ?? 0,
            evidence: s ? supportingEvidence(m.evidence.get(v.person_id) ?? [], s.name).length : 0, date: v.created_at.slice(0, 10) };
        }).filter((v) => v.level > 0),
    };
  }

  // Completeness and next step
  const checks: [boolean, number, TabId, string, string][] = [
    [!!about.headline, 10, "about", "Add a one-line headline about what you do", "Headline"],
    [skills.length >= 5, 20, "skills", `Add ${Math.max(1, 5 - skills.length)} more skill${5 - skills.length === 1 ? "" : "s"} you use`, "Five or more skills"],
    [system.length + own.length > 0, 15, "projects", "Add a project or initiative you worked on", "Projects"],
    [evidence.own.length > 0, 10, "evidence", "Link a skill to the work that proves it", "Evidence linked"],
    [documents.length + certs.era.length + certs.own.length > 0, 10, "documents", "Upload your CV or a certificate", "CV or certificate"],
    [connections.own.length > 0, 10, "connections", "Name a mentor or the people you go to for help", "Connections"],
    [!!growth.goals || growth.targetRoles.length > 0, 10, "growth", "Write a short career goal", "Career goal"],
    [!!av, 10, "availability", "Say whether you are open to projects or mentoring", "Availability"],
    [all("SELECT 1 FROM profile_privacy WHERE person_id = ?", id).length > 0 || history.some((h) => h.section === "privacy"), 5, "privacy", "Review who can see your profile", "Privacy reviewed"],
  ];
  const pct = checks.reduce((s, c) => s + (c[0] ? c[1] : 0), 0);
  const miss = checks.find((c) => !c[0]);

  const badges: ProfileBundle["badges"] = {
    projects: { count: system.length + own.length, attention: own.filter((o) => o.status === "declined").length || undefined },
    skills: { count: skills.length },
    evidence: { count: evidence.own.length },
    documents: { count: documents.length, attention: documents.reduce((s, d) => s + d.suggestions.filter((x) => x.status === "suggested").length, 0) || undefined },
    certs: { count: certs.era.length + certs.own.length },
    connections: { count: connections.own.length },
    feedback: { count: feedback.received.length, attention: feedback.requests.length || undefined },
    suggestions: { attention: suggestions.length || undefined },
    team: team ? { attention: team.projects.length + team.skills.length || undefined } : undefined,
  };

  return {
    me: { id, name: p.name, title: p.title, level: p.level, email: (p as typeof p & { email?: string }).email ?? "", division, department: p.department_id ? m.departments.get(p.department_id) ?? "" : "Leadership",
      location: m.locations.get(p.location_id) ?? "", hireYear: p.hire_year, manager: manager ? { id: manager.id, name: manager.name, title: manager.title } : null,
      reports: reports.length, consent: p.consent_visibility === 1 },
    about,
    completeness: { pct, next: miss ? { tab: miss[2], text: miss[3] } : null, done: checks.filter((c) => c[0]).map((c) => c[4]) },
    badges,
    projects: { system, own },
    skills, growOnly, suggested: suggested.slice(0, 8), evidence, documents, certs, connections, feedback, suggestions, growth, availability,
    privacy: { consent: p.consent_visibility === 1, sections }, history, reports: reportRows, impact, team,
    catalog: {
      skills: [...m.skills.values()].map((s) => ({ id: s.id, name: s.name, family: s.family })).sort((a, b) => a.name.localeCompare(b.name)),
      people: [...m.people.values()].filter((x) => x.id !== id).map((x) => ({ id: x.id, name: x.name, title: x.title })).sort((a, b) => a.name.localeCompare(b.name)),
      certifications: all<{ id: string; name: string; skill_id: string }>("SELECT id, name, skill_id FROM certifications ORDER BY name").map((c) => ({ id: c.id, name: c.name, skill: skillName(c.skill_id) })),
      myProjects: system.map((s) => ({ id: s.projectId, name: s.name })),
      myKnowledge: all<{ id: string; title: string }>("SELECT id, title FROM knowledge_items WHERE author_id = ?", id).map((k) => ({ id: k.id, name: k.title })),
      myIncidents: all<{ id: string; code: string; summary: string }>(
        "SELECT i.id, i.code, i.summary FROM incidents i JOIN incident_resolvers r ON r.incident_id = i.id WHERE r.person_id = ? ORDER BY i.opened DESC", id)
        .map((i) => ({ id: i.id, name: `${i.code}: ${i.summary}`.slice(0, 90) })),
    },
  };
}
