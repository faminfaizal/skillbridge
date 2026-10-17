// The four SkillBridge agents (PRD 8.8). Each declares its goal, triggers, tools, the one step where it uses AI,
// what it may propose, and who approves. Agents never act on people or money on their own.
import type { AgentInfo } from "../types.ts";

export const AGENTS: AgentInfo[] = [
  {
    id: "connectivity", name: "Connectivity Agent", icon: "network",
    goal: "Keep the capability graph true as work happens.",
    triggers: ["Any new record: assignment, incident, customer case, knowledge item, recognition, opportunity, declared skill, purchase request (database triggers)"],
    tools: ["Change log", "Contribution events", "Hidden-skill inference (affected people only)", "Graph update (positions kept)", "Communities and path ranking", "Lens re-scan and diff"],
    aiStep: "Infers hidden skills from the new work records; the evidence check decides what is kept.",
    proposes: ["Publishes the graph diff to the other agents (no human action needed)"],
    approver: "None: it only updates the graph",
  },
  {
    id: "people", name: "People Growth Agent", icon: "trend",
    goal: "Help people grow and get noticed for the work they actually do.",
    triggers: ["Graph diff: new rising star, off-chart contributor, expert to re-engage, or a newly inferred skill"],
    tools: ["Rising stars", "Off-chart contributors", "Experts to re-engage", "Growth paths", "Team scoring"],
    aiStep: "Drafts the note to the manager in plain words, from the evidence only.",
    proposes: ["Recognise a rising contributor", "Put off-chart work on the record (SME role)", "Re-engage a proven expert on open work", "Confirm a newly inferred skill"],
    approver: "The person's manager",
  },
  {
    id: "scout", name: "Opportunity Scout", icon: "spark",
    goal: "Turn existing capability into revenue and avoided spend.",
    triggers: ["New customer opportunity or RFP", "New consultancy purchase request", "Graph diff: new revenue, spend or capacity finding"],
    tools: ["Team formation", "Value formulas", "Opportunity discovery", "Capability and allocation check"],
    aiStep: "Drafts the case for bidding or for holding the purchase, using the engine's figures.",
    proposes: ["Bid from inside (creates an impact record on approval)", "Hold a consultancy purchase and staff it internally (records the cost avoided)"],
    approver: "Head of Sales or Head of Procurement",
  },
  {
    id: "sentinel", name: "Risk Sentinel", icon: "alert",
    goal: "Catch single points of failure before they hurt customers.",
    triggers: ["Graph diff: a system's concentration rises, a new overloaded connector, a new knowledge island"],
    tools: ["Concentration risk", "What-if blast radius", "Overloaded connectors", "Knowledge islands"],
    aiStep: "Drafts a three-step knowledge-transfer or load-sharing plan.",
    proposes: ["Knowledge-transfer plan for a concentrated system", "Share an overloaded person's load", "Open a clinic for a knowledge island"],
    approver: "System owner or department head",
  },
  {
    id: "concierge", name: "Concierge", icon: "brief",
    goal: "Answer any manager's question by calling the right SkillBridge tools and the other agents' findings.",
    triggers: ["A question in Ask AI about people, lenses, agent findings, what if someone leaves, or several things at once"],
    tools: ["Find people", "Person profile", "Staff a request", "Executive answer", "People signals", "Opportunity board", "Agent inbox", "Agent activity", "What-if", "Value dashboard"],
    aiStep: "Plans and calls the tools itself (Gemini function calling on Vertex AI), then writes the answer; a grounding check rejects any figure the tools did not return.",
    proposes: ["Nothing: read-only. Points to the inbox for decisions"],
    approver: "None: it cannot approve or change anything",
  },
];

export const agentName = (id: string) => AGENTS.find((a) => a.id === id)?.name ?? id;
