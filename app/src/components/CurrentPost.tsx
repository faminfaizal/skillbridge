"use client";
// Current post: the person's position record (generated from templates), with each required skill marked met or gap
// against the holder's own capability (met at 0.6, the Challenge Team coverage level).
import { Icon } from "./Icon";
import { gradeLabel } from "../lib/grades";
import type { Position } from "../lib/types";

const MET = 0.6;

export default function CurrentPost({ position: p, heading = true }: { position: Position; heading?: boolean }) {
  const must = p.skills.filter((s) => s.must);
  const nice = p.skills.filter((s) => !s.must);
  const mark = (v: number | undefined) => (v === undefined ? "" : v >= MET ? " post-met" : " chip-gap");
  return (
    <section className="post" aria-label="Current post">
      {heading && <h3 className="section-h"><Icon name="brief" />Current post</h3>}
      <p className="post-h"><b>{p.title}</b> <span className="muted small">{p.id}</span></p>
      <p className="muted small">{gradeLabel(p.level)} · {p.unit}{p.reportsTo ? ` · reports to ${p.reportsTo.title}` : ""}</p>
      <ul className="post-resp small">{p.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul>
      <div className="post-skills">
        <span className="eyebrow">Required skills</span>
        <div className="chips">
          {must.map((s) => (
            <span key={s.skillId} className={`chip${mark(s.value)}`} title={s.value === undefined ? undefined : `${Math.round(s.value * 100)}% capability`}>
              {s.value !== undefined && <Icon name={s.value >= MET ? "check" : "minus"} />}{s.skill}
            </span>
          ))}
        </div>
        {nice.length > 0 && (
          <>
            <span className="eyebrow">Nice to have</span>
            <div className="chips">{nice.map((s) => <span key={s.skillId} className="chip">{s.skill}</span>)}</div>
          </>
        )}
        <span className="eyebrow">Competencies</span>
        <div className="chips">{p.competencies.map((c) => <span key={c} className="chip">{c}</span>)}</div>
      </div>
    </section>
  );
}
