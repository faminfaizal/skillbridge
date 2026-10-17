"use client";
// Top-bar entry to the agents: one dot per agent (green pulse while it runs) and a badge for proposals waiting.
import { Icon } from "./Icon";
import type { AgentsData } from "./AgentsPanel";

export default function AgentsButton({ data, open, onClick }: { data: AgentsData | null; open: boolean; onClick: () => void }) {
  const running = data?.agents.find((a) => a.state === "running");
  const label = `AI agents${running ? `: ${running.name} running` : ""}${data?.pending ? `, ${data.pending} proposal${data.pending === 1 ? "" : "s"} waiting` : ""}`;
  return (
    <button className={`btn btn-ghost agents-btn${data?.busy ? " busy" : ""}`} aria-pressed={open} aria-label={label} onClick={onClick}>
      <Icon name="spark" />
      <span>Agents</span>
      <span className="ag-dots" aria-hidden="true">
        {(data?.agents ?? []).map((a) => <i key={a.id} className={a.state === "running" ? "on" : ""} />)}
      </span>
      {!!data?.pending && <span className="badge" aria-hidden="true">{data.pending}</span>}
    </button>
  );
}
