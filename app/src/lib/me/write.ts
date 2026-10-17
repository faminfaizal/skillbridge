// Write side of My Profile. Every action is validated, logged in profile_changes, and written live: seeded tables
// (skills, certifications, projects, recognition, people) through traceChange/traceInsert so reset restores the seed.
import crypto from "node:crypto";
import fs from "node:fs";
import { all, get, getDb, run } from "../db.ts";
import { bumpDataVersion } from "../cacheVersion.ts";
import { data } from "../engine/data.ts";
import { ensureProfileTables, restoreTraced, traceChange, traceInsert } from "./tables.ts";
import { AUDIENCES, EFFORT_DAYS, EFFORTS, PROJECT_TYPES } from "./types.ts";
import { RECOGNITION_PROMPTS } from "./profile.ts";

export class BadInput extends Error {}

type P = Record<string, unknown>;
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const year = () => Number(today().slice(0, 4));
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function need(cond: unknown, msg: string): asserts cond { if (!cond) throw new BadInput(msg); }
const str = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, max = 20) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, max) : []);
const month = (v: unknown) => (typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : "");
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function skill(id: unknown): string {
  need(typeof id === "string" && data().skills.has(id), "Pick a skill from the list.");
  return id;
}
function person(id: unknown): string {
  need(typeof id === "string" && data().people.has(id), "Pick a person from the list.");
  return id;
}
function level(v: unknown): number {
  const n = Number(v);
  need(Number.isInteger(n) && n >= 1 && n <= 5, "Choose a level from 1 to 5.");
  return n;
}

function log(personId: string, actor: string, section: string, summary: string): void {
  run("INSERT INTO profile_changes (person_id, actor_id, section, summary, at) VALUES (?, ?, ?, ?, ?)", personId, actor, section, summary, now());
}
const skillName = (id: string) => data().skills.get(id)?.name ?? id;
const personName = (id: string) => data().people.get(id)?.name ?? id;

/** Add a skill as self-declared (pending the manager), unless the person already has it. Returns true when added. */
function addSelfSkill(me: string, sid: string, lvl: number, yr: number): boolean {
  if (get("SELECT 1 FROM person_skills WHERE person_id = ? AND skill_id = ?", me, sid)) return false;
  traceInsert(me, "person_skills", { person_id: me, skill_id: sid });
  run("INSERT INTO person_skills (person_id, skill_id, level, source, last_used_year) VALUES (?, ?, ?, 'self', ?)", me, sid, lvl, yr);
  run("INSERT OR REPLACE INTO profile_validations (person_id, skill_id, status, created_at) VALUES (?, ?, 'pending', ?)", me, sid, now());
  return true;
}

function recognise(me: string, to: string, question: string, projectId: string | null): string {
  const id = newId("SELF-REC");
  traceInsert(me, "peer_recognition", { id });
  run("INSERT INTO peer_recognition (id, from_id, to_id, question, project_id, date) VALUES (?, ?, ?, ?, ?, ?)", id, me, to, question, projectId, today());
  return id;
}

function deleteRecognition(me: string, recId: string | null): void {
  if (!recId) return;
  traceChange(me, "peer_recognition", { id: recId });
  run("DELETE FROM peer_recognition WHERE id = ?", recId);
}

/** Apply one profile action for the signed-in person. Returns a short confirmation for the save status. */
export function applyAction(me: string, section: string, action: string, p: P): { message: string; graph: boolean } {
  ensureProfileTables();
  const db = getDb();
  db.exec("BEGIN");
  try {
    const r = dispatch(me, section, action, p);
    db.exec("COMMIT");
    bumpDataVersion();
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function dispatch(me: string, section: string, action: string, p: P): { message: string; graph: boolean } {
  const done = (msg: string, graph = false) => { log(me, me, section, msg); return { message: msg, graph }; };

  switch (`${section}:${action}`) {
    // ---------------------------------------------------------------- About me
    case "about:save": {
      const cur = get<Record<string, string>>("SELECT * FROM profile_about WHERE person_id = ?", me);
      const v = {
        headline: p.headline !== undefined ? str(p.headline, 120) : cur?.headline ?? "",
        bio: p.bio !== undefined ? str(p.bio, 1200) : cur?.bio ?? (get<{ cv_summary: string }>("SELECT cv_summary FROM profiles WHERE person_id = ?", me)?.cv_summary ?? ""),
        languages: p.languages !== undefined ? JSON.stringify(list(p.languages, 10)) : cur?.languages ?? "[]",
        location: p.locationPref !== undefined ? str(p.locationPref, 80) : cur?.location_pref ?? "",
      };
      run(`INSERT INTO profile_about (person_id, headline, bio, languages, location_pref, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(person_id) DO UPDATE SET headline = excluded.headline, bio = excluded.bio, languages = excluded.languages,
           location_pref = excluded.location_pref, updated_at = excluded.updated_at`, me, v.headline, v.bio, v.languages, v.location, now());
      return done(`Updated ${Object.keys(p).map((k) => ({ headline: "headline", bio: "bio", languages: "languages", locationPref: "location preference" } as Record<string, string>)[k] ?? k).join(", ")}`);
    }
    case "about:report":
    case "projects:report": {
      const target = str(p.target, 120);
      const message = str(p.message, 600);
      need(target, "Say which item is wrong.");
      need(message.length >= 5, "Describe what is wrong so the owner can fix it.");
      run("INSERT INTO profile_reports (id, person_id, kind, target, message, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        newId("RPT"), me, section === "about" ? "era" : "project", target, message, now());
      return done(`Reported an error in ${target} to ${section === "about" ? "HR" : "the project owner"}`);
    }

    // ---------------------------------------------------------------- My Projects
    case "projects:add":
    case "projects:update": {
      const name = str(p.name, 120);
      const type = str(p.type, 40);
      const role = str(p.role, 80);
      const start = month(p.start);
      const end = p.end ? month(p.end) : "";
      need(name, "Give the project a name.");
      need((PROJECT_TYPES as readonly string[]).includes(type), "Choose a project type.");
      need(role, "Say what your role was.");
      need(start, "Pick the month you started.");
      need(!p.end || end, "Pick a valid end month, or leave it empty if ongoing.");
      need(!end || end >= start, "The end month cannot be before the start month.");
      const effort = str(p.effort, 40);
      need(!effort || (EFFORTS as readonly string[]).includes(effort), "Choose an effort range.");
      const skills = list(p.skills, 12).map(skill);
      const fields = [name, type, role, start, end || null, effort, str(p.contribution, 1200), JSON.stringify(skills), str(p.link, 300)];
      let id = String(p.id ?? "");
      if (action === "add") {
        id = newId("PP");
        run(`INSERT INTO profile_projects (id, person_id, name, type, role, start_month, end_month, effort, contribution, skills, link, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`, id, me, ...fields, now());
      } else {
        const cur = get<{ status: string }>("SELECT status FROM profile_projects WHERE id = ? AND person_id = ?", id, me);
        need(cur, "That project entry no longer exists.");
        need(cur.status !== "confirmed", "A confirmed project is now part of the project records. Remove it and add it again to change it.");
        run(`UPDATE profile_projects SET name = ?, type = ?, role = ?, start_month = ?, end_month = ?, effort = ?, contribution = ?, skills = ?, link = ?,
             status = 'pending', decided_by = NULL, decided_at = NULL, decline_note = NULL WHERE id = ?`, ...fields, id);
      }
      const yr = Number((end || start).slice(0, 4));
      const added = skills.filter((s) => addSelfSkill(me, s, 2, yr));
      const extra = added.length ? `; added ${added.map(skillName).join(", ")} to your skills` : "";
      return done(`${action === "add" ? "Added" : "Updated"} project "${name}", awaiting your manager${extra}`, added.length > 0);
    }
    case "projects:remove": {
      const cur = get<{ name: string; project_id: string | null }>("SELECT name, project_id FROM profile_projects WHERE id = ? AND person_id = ?", p.id as string, me);
      need(cur, "That project entry no longer exists.");
      if (cur.project_id) {
        for (const a of all<{ id: string }>("SELECT id FROM assignments WHERE project_id = ?", cur.project_id)) {
          traceChange(me, "assignments", { id: a.id });
          run("DELETE FROM assignments WHERE id = ?", a.id);
        }
        for (const s of all<{ skill_id: string }>("SELECT skill_id FROM project_skills WHERE project_id = ?", cur.project_id)) {
          traceChange(me, "project_skills", { project_id: cur.project_id, skill_id: s.skill_id });
        }
        run("DELETE FROM project_skills WHERE project_id = ?", cur.project_id);
        traceChange(me, "projects", { id: cur.project_id });
        run("DELETE FROM projects WHERE id = ?", cur.project_id);
      }
      run("DELETE FROM profile_projects WHERE id = ?", p.id as string);
      return done(`Removed project "${cur.name}"`, !!cur.project_id);
    }
    case "projects:hide": {
      need(typeof p.projectId === "string", "Pick a project.");
      if (p.hidden) run("INSERT OR IGNORE INTO profile_hidden (person_id, kind, ref_id) VALUES (?, 'project', ?)", me, p.projectId);
      else run("DELETE FROM profile_hidden WHERE person_id = ? AND kind = 'project' AND ref_id = ?", me, p.projectId);
      return done(`${p.hidden ? "Hid" : "Showed"} ${data().projects.get(p.projectId)?.name ?? "a project"} ${p.hidden ? "from" : "to"} others`);
    }

    // ---------------------------------------------------------------- Skills
    case "skills:add": {
      const sid = skill(p.skillId);
      need(!get("SELECT 1 FROM person_skills WHERE person_id = ? AND skill_id = ?", me, sid), `${skillName(sid)} is already on your profile.`);
      const yr = p.year ? Number(p.year) : year();
      need(Number.isInteger(yr) && yr >= 1980 && yr <= year(), "Pick the year you last used it.");
      addSelfSkill(me, sid, level(p.level), yr);
      run("DELETE FROM profile_skill_meta WHERE person_id = ? AND skill_id = ? AND want_grow = 0", me, sid);
      return done(`Added ${skillName(sid)} at level ${p.level}`, true);
    }
    case "skills:update": {
      const sid = skill(p.skillId);
      const cur = get<{ level: number; last_used_year: number; source: string }>("SELECT level, last_used_year, source FROM person_skills WHERE person_id = ? AND skill_id = ?", me, sid);
      need(cur, `${skillName(sid)} is not on your profile.`);
      const parts: string[] = [];
      if (p.level !== undefined || p.year !== undefined) {
        const lvl = p.level !== undefined ? level(p.level) : cur.level;
        const yr = p.year !== undefined ? Number(p.year) : cur.last_used_year;
        need(Number.isInteger(yr) && yr >= 1980 && yr <= year(), "Pick the year you last used it.");
        traceChange(me, "person_skills", { person_id: me, skill_id: sid });
        run("UPDATE person_skills SET level = ?, last_used_year = ?, source = 'self' WHERE person_id = ? AND skill_id = ?", lvl, yr, me, sid);
        if (lvl !== cur.level) {
          run("INSERT OR REPLACE INTO profile_validations (person_id, skill_id, status, created_at) VALUES (?, ?, 'pending', ?)", me, sid, now());
          parts.push(`level ${cur.level} to ${lvl}`);
        }
        if (yr !== cur.last_used_year) parts.push(`last used ${yr}`);
      }
      if (p.wantGrow !== undefined) {
        run("INSERT OR REPLACE INTO profile_skill_meta (person_id, skill_id, want_grow) VALUES (?, ?, ?)", me, sid, p.wantGrow ? 1 : 0);
        parts.push(p.wantGrow ? "marked want to grow" : "unmarked want to grow");
      }
      return done(`${skillName(sid)}: ${parts.join(", ") || "no change"}`);
    }
    case "skills:remove": {
      const sid = skill(p.skillId);
      traceChange(me, "person_skills", { person_id: me, skill_id: sid });
      run("DELETE FROM person_skills WHERE person_id = ? AND skill_id = ?", me, sid);
      run("DELETE FROM profile_validations WHERE person_id = ? AND skill_id = ?", me, sid);
      run("DELETE FROM profile_skill_meta WHERE person_id = ? AND skill_id = ?", me, sid);
      return done(`Removed ${skillName(sid)}`);
    }
    case "skills:grow": {
      const sid = skill(p.skillId);
      if (p.wantGrow) run("INSERT OR REPLACE INTO profile_skill_meta (person_id, skill_id, want_grow) VALUES (?, ?, 1)", me, sid);
      else run("DELETE FROM profile_skill_meta WHERE person_id = ? AND skill_id = ?", me, sid);
      return done(`${p.wantGrow ? "Want to grow" : "No longer growing"}: ${skillName(sid)}`);
    }
    case "skills:suggest": {
      const name = str(p.name, 80);
      need(name.length >= 2, "Type the name of the skill you want added.");
      need(!data().skillByName.has(name.toLowerCase()), `${name} is already in the skills list. Search for it instead.`);
      run("INSERT INTO profile_reports (id, person_id, kind, target, message, created_at) VALUES (?, ?, 'new_skill', ?, ?, ?)", newId("RPT"), me, name, "Please add this skill to the taxonomy", now());
      return done(`Suggested "${name}" to HR for the skills list`);
    }

    // ---------------------------------------------------------------- Evidence
    case "evidence:add": {
      const sid = skill(p.skillId);
      const kind = str(p.kind, 20);
      need(["project", "incident", "knowledge", "certification", "document", "external"].includes(kind), "Choose what kind of evidence this is.");
      const ref = p.refId ? str(p.refId, 60) : null;
      need(kind === "external" || ref, "Pick the item that shows this skill.");
      const note = str(p.note, 600);
      need(kind !== "external" || note.length >= 5, "Describe the work, since it is not in any system.");
      const date = isDate(p.date) ? (p.date as string) : today();
      run("INSERT INTO profile_evidence (id, person_id, skill_id, kind, ref_id, note, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        newId("EV"), me, sid, kind, ref, note, date, now());
      return done(`Linked ${kind} evidence to ${skillName(sid)}`);
    }
    case "evidence:remove": {
      const cur = get<{ skill_id: string }>("SELECT skill_id FROM profile_evidence WHERE id = ? AND person_id = ?", p.id as string, me);
      need(cur, "That evidence no longer exists.");
      run("DELETE FROM profile_evidence WHERE id = ?", p.id as string);
      return done(`Removed evidence for ${skillName(cur.skill_id)}`);
    }
    case "evidence:hide": {
      run("UPDATE profile_evidence SET hidden = ? WHERE id = ? AND person_id = ?", p.hidden ? 1 : 0, p.id as string, me);
      return done(`${p.hidden ? "Hid" : "Showed"} an evidence item`);
    }

    // ---------------------------------------------------------------- Documents
    case "documents:suggestion": {
      const sid = skill(p.skillId);
      const doc = get<{ id: string; filename: string }>("SELECT id, filename FROM profile_documents WHERE id = ? AND person_id = ?", p.docId as string, me);
      need(doc, "That document no longer exists.");
      const s = get<{ level: number }>("SELECT level FROM profile_doc_skills WHERE doc_id = ? AND skill_id = ?", doc.id, sid);
      need(s, "That suggestion no longer exists.");
      if (p.decision === "reject") {
        run("UPDATE profile_doc_skills SET status = 'rejected' WHERE doc_id = ? AND skill_id = ?", doc.id, sid);
        return done(`Rejected ${skillName(sid)} from ${doc.filename}`);
      }
      const lvl = p.level !== undefined ? level(p.level) : s.level;
      run("UPDATE profile_doc_skills SET status = 'accepted', level = ? WHERE doc_id = ? AND skill_id = ?", lvl, doc.id, sid);
      let added = false;
      if (!get("SELECT 1 FROM person_skills WHERE person_id = ? AND skill_id = ?", me, sid)) {
        traceInsert(me, "person_skills", { person_id: me, skill_id: sid });
        run("INSERT INTO person_skills (person_id, skill_id, level, source, last_used_year) VALUES (?, ?, ?, 'cv', ?)", me, sid, lvl, year());
        added = true;
      }
      run("INSERT INTO profile_evidence (id, person_id, skill_id, kind, ref_id, note, date, created_at) VALUES (?, ?, ?, 'document', ?, ?, ?, ?)",
        newId("EV"), me, sid, doc.id, "From uploaded document", today(), now());
      return done(added ? `Added ${skillName(sid)} from ${doc.filename}` : `Linked ${doc.filename} as evidence for ${skillName(sid)}`, added);
    }
    case "documents:share": {
      run("UPDATE profile_documents SET shared = ? WHERE id = ? AND person_id = ?", p.shared ? 1 : 0, p.docId as string, me);
      return done(`${p.shared ? "Shared a document with your manager" : "Made a document private"}`);
    }
    case "documents:remove": {
      const doc = get<{ id: string; filename: string; path: string }>("SELECT id, filename, path FROM profile_documents WHERE id = ? AND person_id = ?", p.docId as string, me);
      need(doc, "That document no longer exists.");
      run("DELETE FROM profile_doc_skills WHERE doc_id = ?", doc.id);
      run("DELETE FROM profile_evidence WHERE kind = 'document' AND ref_id = ?", doc.id);
      run("DELETE FROM profile_documents WHERE id = ?", doc.id);
      try { fs.unlinkSync(doc.path); } catch { /* already gone */ }
      return done(`Deleted ${doc.filename}; skills you accepted from it stay on your profile`);
    }

    // ---------------------------------------------------------------- Certifications
    case "certs:addCatalog": {
      need(typeof p.certId === "string", "Pick a certification from the list.");
      const c = get<{ id: string; name: string; skill_id: string }>("SELECT id, name, skill_id FROM certifications WHERE id = ?", p.certId);
      need(c, "Pick a certification from the list.");
      need(!get("SELECT 1 FROM person_certs WHERE person_id = ? AND cert_id = ?", me, c.id), `${c.name} is already on your profile.`);
      const yr = Number(p.year ?? year());
      need(Number.isInteger(yr) && yr >= 1980 && yr <= year(), "Pick the year you earned it.");
      traceInsert(me, "person_certs", { person_id: me, cert_id: c.id });
      run("INSERT INTO person_certs (person_id, cert_id, year) VALUES (?, ?, ?)", me, c.id, yr);
      return done(`Added certification ${c.name}`, true);
    }
    case "certs:removeCatalog": {
      need(typeof p.certId === "string", "Pick a certification.");
      const traced = get<{ original: string | null }>("SELECT original FROM profile_trace WHERE tbl = 'person_certs' AND key = ?", JSON.stringify([me, p.certId]));
      need(traced && traced.original === null, "Certifications from ERA can only be corrected by HR. Use Report an error.");
      run("DELETE FROM person_certs WHERE person_id = ? AND cert_id = ?", me, p.certId);
      return done("Removed a certification you added");
    }
    case "certs:addOwn":
    case "certs:updateOwn": {
      const name = str(p.name, 120);
      need(name, "Give the certification a name.");
      const issued = p.issued ? month(p.issued) : "";
      const expiry = p.expiry ? month(p.expiry) : "";
      need(!p.issued || issued, "Pick a valid month for when it was issued.");
      need(!p.expiry || expiry, "Pick a valid expiry month.");
      need(!issued || !expiry || expiry >= issued, "Expiry cannot be before the issue date.");
      if (action === "addOwn") {
        run("INSERT INTO profile_certs (id, person_id, name, issuer, issued, expiry, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", newId("PC"), me, name, str(p.issuer, 120), issued, expiry, now());
      } else {
        run("UPDATE profile_certs SET name = ?, issuer = ?, issued = ?, expiry = ? WHERE id = ? AND person_id = ?", name, str(p.issuer, 120), issued, expiry, p.id as string, me);
      }
      return done(`${action === "addOwn" ? "Added" : "Updated"} certification ${name}`);
    }
    case "certs:removeOwn": {
      run("DELETE FROM profile_certs WHERE id = ? AND person_id = ?", p.id as string, me);
      return done("Removed a certification");
    }

    // ---------------------------------------------------------------- Connections
    case "connections:add": {
      const other = person(p.otherId);
      need(other !== me, "Pick someone other than yourself.");
      const kind = str(p.kind, 10);
      need(["mentor", "mentee", "goto"].includes(kind), "Choose mentor, mentee or go-to person.");
      const sid = kind === "goto" ? skill(p.skillId) : null;
      need(!get("SELECT 1 FROM profile_connections WHERE person_id = ? AND other_id = ? AND kind = ? AND IFNULL(skill_id, '') = ?", me, other, kind, sid ?? ""),
        `${personName(other)} is already listed.`);
      const recId = sid ? recognise(me, other, `Who do you go to for ${skillName(sid)}?`, null) : null;
      run("INSERT INTO profile_connections (id, person_id, other_id, kind, skill_id, rec_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", newId("CN"), me, other, kind, sid, recId, now());
      const label = kind === "goto" ? `go-to person for ${skillName(sid!)}` : kind;
      return done(`Added ${personName(other)} as ${label}`, !!recId);
    }
    case "connections:remove": {
      const c = get<{ other_id: string; rec_id: string | null }>("SELECT other_id, rec_id FROM profile_connections WHERE id = ? AND person_id = ?", p.id as string, me);
      need(c, "That connection no longer exists.");
      deleteRecognition(me, c.rec_id);
      run("DELETE FROM profile_connections WHERE id = ?", p.id as string);
      return done(`Removed ${personName(c.other_id)} from your connections`);
    }

    // ---------------------------------------------------------------- Peer feedback
    case "feedback:give": {
      const to = person(p.toId);
      need(to !== me, "Feedback is for someone else.");
      const question = str(p.question, 120);
      need(RECOGNITION_PROMPTS.includes(question), "Choose what you are recognising them for.");
      const projectId = typeof p.projectId === "string" && data().projects.has(p.projectId) ? p.projectId : null;
      const sid = p.skillId ? skill(p.skillId) : null;
      const recId = recognise(me, to, question, projectId);
      run("INSERT INTO profile_feedback (id, from_id, to_id, rec_id, skill_id, project_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        newId("FB"), me, to, recId, sid, projectId, str(p.text, 800), now());
      if (typeof p.requestId === "string") run("UPDATE profile_feedback_requests SET status = 'done' WHERE id = ? AND to_id = ?", p.requestId, me);
      log(to, me, "feedback", `${personName(me)} recognised you: ${question}`);
      return done(`Sent recognition to ${personName(to)}`, true);
    }
    case "feedback:hide": {
      need(typeof p.recId === "string", "Pick an item.");
      if (p.hidden) run("INSERT OR IGNORE INTO profile_hidden (person_id, kind, ref_id) VALUES (?, 'recognition', ?)", me, p.recId);
      else run("DELETE FROM profile_hidden WHERE person_id = ? AND kind = 'recognition' AND ref_id = ?", me, p.recId);
      return done(`${p.hidden ? "Hid" : "Showed"} a recognition`);
    }
    case "feedback:thank": {
      need(typeof p.recId === "string", "Pick an item.");
      const r = get<{ from_id: string }>("SELECT from_id FROM peer_recognition WHERE id = ? AND to_id = ?", p.recId, me);
      need(r, "That recognition no longer exists.");
      const f = get<{ id: string }>("SELECT id FROM profile_feedback WHERE rec_id = ?", p.recId);
      if (f) run("UPDATE profile_feedback SET thanked = 1 WHERE id = ?", f.id);
      else run("INSERT INTO profile_feedback (id, from_id, to_id, rec_id, text, thanked, created_at) VALUES (?, ?, ?, ?, '', 1, ?)", newId("FB"), r.from_id, me, p.recId, now());
      log(r.from_id, me, "feedback", `${personName(me)} thanked you for your recognition`);
      return done(`Thanked ${personName(r.from_id)}`);
    }
    case "feedback:request": {
      need(typeof p.projectId === "string" && data().projects.has(p.projectId), "Pick one of your projects.");
      const members = all<{ person_id: string }>("SELECT DISTINCT person_id FROM assignments WHERE project_id = ? AND person_id <> ?", p.projectId, me);
      need(members.length, "Nobody else is recorded on that project.");
      for (const m of members) {
        if (get("SELECT 1 FROM profile_feedback_requests WHERE from_id = ? AND to_id = ? AND project_id = ? AND status = 'open'", me, m.person_id, p.projectId)) continue;
        run("INSERT INTO profile_feedback_requests (id, from_id, to_id, project_id, created_at) VALUES (?, ?, ?, ?, ?)", newId("FR"), me, m.person_id, p.projectId, now());
      }
      return done(`Asked ${members.length} project member${members.length > 1 ? "s" : ""} on ${data().projects.get(p.projectId)!.name} for feedback`);
    }
    case "feedback:dismiss": {
      run("UPDATE profile_feedback_requests SET status = 'dismissed' WHERE id = ? AND to_id = ?", p.id as string, me);
      return done("Dismissed a feedback request");
    }

    // ---------------------------------------------------------------- AI suggestions
    case "suggestions:decide": {
      const sid = skill(p.skillId);
      need(p.decision === "confirm" || p.decision === "decline", "Choose confirm or decline.");
      run("INSERT OR REPLACE INTO profile_suggestion_decisions (person_id, skill_id, decision, created_at) VALUES (?, ?, ?, ?)", me, sid, p.decision, now());
      if (p.decision === "decline") return done(`Declined the AI suggestion ${skillName(sid)}`);
      const lvl = p.level !== undefined ? level(p.level) : 3;
      if (!get("SELECT 1 FROM person_skills WHERE person_id = ? AND skill_id = ?", me, sid)) {
        traceInsert(me, "person_skills", { person_id: me, skill_id: sid });
        run("INSERT INTO person_skills (person_id, skill_id, level, source, last_used_year) VALUES (?, ?, ?, 'confirmed', ?)", me, sid, lvl, year());
      }
      return done(`Confirmed ${skillName(sid)} at level ${lvl}`, true);
    }

    // ---------------------------------------------------------------- Interests and growth
    case "growth:save": {
      const cur = get<Record<string, string>>("SELECT * FROM profile_growth WHERE person_id = ?", me);
      const seed = get<{ interests: string }>("SELECT interests FROM profiles WHERE person_id = ?", me)?.interests;
      const interests = p.interests !== undefined ? JSON.stringify(list(p.interests, 15)) : cur?.interests ?? JSON.stringify(seed ? seed.split(",").map((s) => s.trim()).filter(Boolean) : []);
      const goals = p.goals !== undefined ? str(p.goals, 800) : cur?.goals ?? "";
      const roles = p.targetRoles !== undefined ? JSON.stringify(list(p.targetRoles, 8)) : cur?.target_roles ?? "[]";
      run(`INSERT INTO profile_growth (person_id, interests, goals, target_roles, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(person_id) DO UPDATE SET interests = excluded.interests, goals = excluded.goals, target_roles = excluded.target_roles, updated_at = excluded.updated_at`,
        me, interests, goals, roles, now());
      return done(`Updated ${p.interests !== undefined ? "interests" : p.goals !== undefined ? "career goal" : "target roles"}`);
    }

    // ---------------------------------------------------------------- Availability
    case "availability:save": {
      const cur = get<Record<string, any>>("SELECT * FROM profile_availability WHERE person_id = ?", me);
      const flag = (k: string, col: string) => (p[k] !== undefined ? (p[k] ? 1 : 0) : cur?.[col] ?? 0);
      const until = p.until !== undefined ? (p.until ? (isDate(p.until) ? (p.until as string) : "") : "") : cur?.until ?? "";
      need(p.until === undefined || !p.until || until, "Pick a valid date.");
      run(`INSERT INTO profile_availability (person_id, open_projects, open_sme, open_mentoring, until, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(person_id) DO UPDATE SET open_projects = excluded.open_projects, open_sme = excluded.open_sme,
           open_mentoring = excluded.open_mentoring, until = excluded.until, updated_at = excluded.updated_at`,
        me, flag("openProjects", "open_projects"), flag("openSme", "open_sme"), flag("openMentoring", "open_mentoring"), until, now());
      if (p.pct !== undefined) {
        const pct = Number(p.pct);
        need(Number.isInteger(pct) && pct >= 0 && pct <= 100 && pct % 5 === 0, "Choose availability in steps of 5%.");
        traceChange(me, "people", { id: me });
        run("UPDATE people SET availability_pct = ? WHERE id = ?", pct, me);
        return done(`Set availability for other work to ${pct}%`);
      }
      return done("Updated what you are open to");
    }

    // ---------------------------------------------------------------- Privacy
    case "privacy:audience": {
      const section = str(p.section, 20);
      need(AUDIENCES.some((a) => a.id === p.audience), "Choose who can see this.");
      run("INSERT OR REPLACE INTO profile_privacy (person_id, section, audience) VALUES (?, ?, ?)", me, section, p.audience as string);
      return done(`${section}: visible to ${AUDIENCES.find((a) => a.id === p.audience)!.label.toLowerCase()}`);
    }
    case "privacy:consent": {
      traceChange(me, "people", { id: me });
      run("UPDATE people SET consent_visibility = ? WHERE id = ?", p.consent ? 1 : 0, me);
      return done(p.consent ? "Opted in to discovery: you can be matched to teams and opportunities" : "Opted out of discovery: you appear only in totals");
    }

    default:
      throw new BadInput(`Unknown action ${section}:${action}.`);
  }
}

/** Manager decisions on a direct report's project entry or self-declared skill. */
export function decideForTeam(manager: string, kind: "project" | "skill", p: P): { message: string; graph: boolean } {
  ensureProfileTables();
  const decision = p.decision;
  need(decision === "confirm" || decision === "decline", "Choose confirm or decline.");
  const db = getDb();
  db.exec("BEGIN");
  try {
    let out: { message: string; graph: boolean };
    if (kind === "project") {
      const e = get<Record<string, any>>("SELECT * FROM profile_projects WHERE id = ?", p.id as string);
      need(e, "That project entry no longer exists.");
      need(data().people.get(e.person_id)?.manager_id === manager, "You can only confirm entries from your direct reports.");
      need(e.status === "pending", `Already ${e.status}.`);
      if (decision === "decline") {
        const note = str(p.note, 300);
        need(note.length >= 3, "Tell them why, so they can fix the entry.");
        run("UPDATE profile_projects SET status = 'declined', decided_by = ?, decided_at = ?, decline_note = ? WHERE id = ?", manager, now(), note, e.id);
        out = { message: `Declined "${e.name}" for ${personName(e.person_id)}`, graph: false };
      } else {
        const pid = `SELF-PRJ-${e.id.slice(3)}`;
        const aid = `SELF-ASG-${e.id.slice(3)}`;
        const owner = data().people.get(e.person_id)!;
        const endDate = e.end_month ? `${e.end_month}-28` : today();
        const status = e.end_month && endDate < today() ? "completed" : "active";
        traceInsert(e.person_id, "projects", { id: pid });
        run(`INSERT INTO projects (id, code, name, type, division_id, sponsor_id, pm_id, status, start_date, end_date, budget_amt, external_spend_amt, outcome, value_amt,
             customer_id, problem_class_id, location_id, description) VALUES (?, ?, ?, 'self-reported', ?, NULL, NULL, ?, ?, ?, 0, 0, ?, 0, NULL, NULL, ?, ?)`,
          pid, pid, e.name, owner.division_id, status, `${e.start_month}-01`, endDate, `${e.type}, confirmed by ${personName(manager)}`, owner.location_id,
          e.contribution || `${e.type}: ${e.name}`);
        for (const sid of JSON.parse(e.skills) as string[]) {
          traceInsert(e.person_id, "project_skills", { project_id: pid, skill_id: sid });
          run("INSERT OR IGNORE INTO project_skills (project_id, skill_id) VALUES (?, ?)", pid, sid);
        }
        traceInsert(e.person_id, "assignments", { id: aid });
        run(`INSERT INTO assignments (id, project_id, person_id, role, allocation_pct, man_days, contribution_note, start_date, end_date)
             VALUES (?, ?, ?, ?, 20, ?, ?, ?, ?)`, aid, pid, e.person_id, e.role, EFFORT_DAYS[e.effort] ?? 10, e.contribution || `${e.role} on ${e.name}`,
          `${e.start_month}-01`, endDate);
        run("UPDATE profile_projects SET status = 'confirmed', decided_by = ?, decided_at = ?, project_id = ? WHERE id = ?", manager, now(), pid, e.id);
        out = { message: `Confirmed "${e.name}" for ${personName(e.person_id)}; it is now in the project records`, graph: true };
      }
      log(e.person_id, manager, "projects", out.message.replace(` for ${personName(e.person_id)}`, ""));
    } else {
      const personId = person(p.personId);
      const sid = skill(p.skillId);
      need(data().people.get(personId)?.manager_id === manager, "You can only confirm skills for your direct reports.");
      const v = get<{ status: string }>("SELECT status FROM profile_validations WHERE person_id = ? AND skill_id = ?", personId, sid);
      need(v?.status === "pending", "Nothing to confirm for that skill.");
      run("UPDATE profile_validations SET status = ?, decided_by = ?, decided_at = ? WHERE person_id = ? AND skill_id = ?",
        decision === "confirm" ? "confirmed" : "declined", manager, now(), personId, sid);
      if (decision === "confirm") {
        traceChange(personId, "person_skills", { person_id: personId, skill_id: sid });
        run("UPDATE person_skills SET source = 'validated' WHERE person_id = ? AND skill_id = ?", personId, sid);
      }
      out = { message: `${decision === "confirm" ? "Confirmed" : "Declined"} ${skillName(sid)} for ${personName(personId)}`, graph: false };
      log(personId, manager, "skills", out.message.replace(` for ${personName(personId)}`, ""));
    }
    log(manager, manager, "team", out.message);
    db.exec("COMMIT");
    bumpDataVersion();
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Undo all self-service changes (one person or everyone): delete uploaded files, restore traced rows, clear profile tables. */
export function resetProfiles(personId?: string): number {
  ensureProfileTables();
  for (const d of all<{ path: string }>(personId ? "SELECT path FROM profile_documents WHERE person_id = ?" : "SELECT path FROM profile_documents", ...(personId ? [personId] : []))) {
    try { fs.unlinkSync(d.path); } catch { /* already gone */ }
  }
  const n = restoreTraced(personId);
  bumpDataVersion();
  return n;
}
