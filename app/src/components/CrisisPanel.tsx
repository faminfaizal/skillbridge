"use client";
// Incident response team: situation report (text or photo) in, nearby team out. Owned by the respond track (T2). Stub.
import type { ActPanelProps } from "./actPanels";

export default function CrisisPanel(_props: ActPanelProps) {
  return (
    <div className="panel-body">
      <div className="eyebrow">Act</div>
      <h2 className="panel-title">Incident response team</h2>
      <p className="muted small">Coming shortly.</p>
    </div>
  );
}
