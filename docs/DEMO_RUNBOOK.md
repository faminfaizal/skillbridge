# SkillBridge Demo Runbook

| Field | Value |
|---|---|
| Length | 3-minute demo video |
| Host | Deployed on Cloud Run behind Firebase Hosting; any browser |
| App | The Firebase Hosting URL, or http://localhost:3012 when run locally |
| Backup | The submitted demo video |

All data is synthetic (fictional company Veridane Networks). No real personal data.

## Before the session (T-30 min)

1. Locally, from `app/`: `npm run build` then `npm start` (port 3012). Deployed: open the hosting URL.
2. Health checks:
   - `npm run smoke` (from `app/`) → Gemini chat, fast, embeddings and function calling should PASS. If Gemini is unreachable, scripted questions still answer from the cache.
   - `python tools/warm_cache.py` → all 8 staffing and 7 executive questions answer, and Activate + reset works. This refreshes the golden cache.
3. Open the app in Chrome, full screen (F11), zoom 100%. The pill at the top right should read **AI live** (green: Gemini on Vertex AI answers); **AI offline** means answers come from the cache. Click the pill for the model, latency and **Check now**.
4. Open `/value` in a second tab and check that it shows **$1.50M**. If it is higher, click **Reset demo records**.
5. If the network is unreliable: stop the app and restart it with `$env:LLM_MODE="cache-first"; npm start`. Scripted questions are then answered from the cache in under 100 ms.

## Live demo (about 2 minutes)

| # | Do | Audience sees | Say |
|---|---|---|---|
| 1 | Land on `/` | **W1** the living galaxy: 300 people, projects and systems, with work flowing along links | "This is the whole company, clustered by real work, not the org chart." |
| 2 | Click the suggestion **"We need to deliver an AI-powered customer analytics project."** | **W2** the graph collapses to 6 people and 1 gap; the panel shows **$120k / $45k / $300k** | "One sentence. Six internal people. One gap." |
| 3 | Open **Why this person?** on **Hafiz Rahman** (gold card) | **W3** a dashed gold line shows his inferred skill. Python and Test Automation come from evidence: Network Test Lab automation, pytest KI-117, INC-042 | "His title says Network Engineer. His work says automation engineer. Every inference shows its evidence." |
| 4 | Scroll to the **MLOps gap** | Lim Wei Ling 75% to 84% ready; MLOps and Model Monitoring bars grow; 2 short courses + 1 assignment = 9 weeks, $4,700, against a 26-week $14k certificate; $40k hiring avoided | "We don't hire for the gap; we close it in 9 weeks." |
| 5 | Click **Challenge Team**, then on the MLOps card **AI: best available**, then **Activate Team** | The dialog: team match **78%** with four scored parts, each person's score and breakdown, a skill-by-member matrix. Filling MLOps raises it to **82% (+4 pts)**. **Choose person** lets a manager name anyone (e.g. "lim" → Lim Wei Ling, 81%). Activate: toast, record created | "Managers can challenge the AI: swap anyone, see the score move, then activate. Now it is money we can count." |
| 6 | Open **Value dashboard** | **W8** total goes from $1.50M to **$1.97M**; NEW record; reinvestment flow | "And it flows into reinvestment: where should the value go next?" |
| 7 (if time) | **Explore** menu → **Hidden talent** | **W4** Priya Nair as a star: 6 projects, high cross-team dependency, low visibility | "Recognition, not surveillance: only people who opted in." |
| 8 (Q&A) | **Explore** → **Dependency risk** → **What if these 3 leave?** | **W5** RatePro 78% dependent on 3 people; the blast radius reaches billing and 5 customers | "Where are we over-dependent on individuals?" |

**AI agents (the agentic wow, 60 to 90 s):** click **Agents** in the top bar (dots show each agent; the badge counts proposals waiting).

| # | Do | Audience sees | Say |
|---|---|---|---|
| A1 | **Simulate: Consultancy purchase request** | Within seconds the Connectivity Agent runs, then the Opportunity Scout drafts "Hold purchase: Kubernetes consultants ($200k)", $168k avoided, with the internal experts who are free (about 2 to 3 s) | "Nobody asked SkillBridge anything. A purchase request landed in the data, and an agent caught it." |
| A2 | **Approve** | Toast: purchase held, impact record created; the value dashboard rises | "Agents propose, people decide. One click, and it is money we can count." |
| A3 | **Simulate: Field coordinator fixes a NOVA alarm** | The graph ripples green where the new records landed; a gold dashed link shows a newly inferred skill; People Growth asks her manager to confirm it and to put her off-chart work on the record | "The graph keeps itself true, and it keeps noticing people." |
| A4 (Q&A) | **Simulate: RatePro fails again overnight** → **Activity** tab | Risk Sentinel: RatePro concentration up to 81%, a three-step knowledge-transfer plan; each run lists its tool calls, AI steps marked | "Every agent shows its working." |

Each run's tool calls, timings and AI provider are in **Activity**; the roster with triggers, tools and approvers is in **Agents**. After the demo: **Reset agent demo** (bottom of the panel) removes every simulated record, proposal and agent impact record.

**Concierge agent (30 s):** click a chip under "Ask the Concierge agent", or type a mixed question such as "Is anyone overloaded, and who connects teams that would otherwise not talk?". The agent picks its own tools (shown under **How I answered**, AI steps marked), answers in about 3 s, and the badge **Every figure from the tools** shows the grounding check passed. Other good ones: "Tell me about Hafiz Rahman" (two rounds: find, then profile), "What happens if Priya Nair leaves?", "What did the agents find today?" (best after a simulation). Say: "It does not guess. It calls the same engines you have seen, and refuses figures it cannot find."

**Executive questions (for the GM audience, 30 s each):** click a chip under "Ask as an executive", or type any of the PRD questions. The panel leads with the **decision**, then an AI brief, three figures, the evidence table and next steps.

| Question | Decision shown |
|---|---|
| Where are our biggest capability gaps? | 9 gaps hold back $2.22M; 6 closable by reskilling (MLOps: Lim in 9 weeks) |
| What are we paying external parties for that we already possess? | $1.98M of consultancy since Oct 2024 bought skills we had (Project Management $525k, ML $479k, Kubernetes $450k) |
| Which skills become critical in 2 years? | LLM Applications, Conversational AI Ops, MLOps, Model Monitoring: in demand, held by 2 people or fewer |
| Where are we over-dependent on individuals? | RatePro: 3 people hold 78%, one retiring, 5 customers exposed |
| Which under-utilised capabilities could generate revenue? | $1.65M of demand covered from inside; smart campus asked 7 times |
| How much value did internal reuse create this quarter? | 2026 Q3 $262k; $676k this year; $1.50M in total (changes after Activate) |
| Where should we invest the savings? | Fund reskilling and innovation first, with the evidence for each initiative |

Questions phrased differently ("Are we too reliant on a few people for billing?") are routed by the AI classifier.

**Explore menu:** every lens sits under the **Explore** dropdown in the top bar (keyboard: Enter or arrow keys, Escape to close). Groups: Graph, Opportunities, People (Hidden talent, Rising stars, Collaboration bridges, Experts to re-engage, Off-chart contributors), Risk (Dependency risk, Overloaded connectors, Knowledge islands).

**Opportunities (discovery board):** **Explore** → **Opportunities** (or `/?mode=discover`). 17 cards, about $3.6M: revenue offers, consultancy we did not need, spare capacity (Lisbon data engineering), hires avoidable (Ganesh for REQ-001, Hafiz for REQ-002), reskill-instead-of-hire (Lim for REQ-012), the two churn models built twice, Joseph as hidden expert, collaboration gaps, RatePro key-person risk and 5 SME requests. **Show on graph** lights up each card's evidence; filter chips narrow by type.

**People signals (30 s each, pick one or two):**

| Lens | What to show | Say |
|---|---|---|
| Collaboration bridges | Priya Nair: the only link between BSS/Billing and 6 other teams; collaboration path rank 1 of 294 | "Lose her and six teams stop talking." |
| Rising stars | Priya: 2.0 to 4.3 contributions a month; quarter bars turn blue in 2026 | "Growth you can see before the appraisal cycle does." |
| Overloaded connectors | Priya: 100% of billing incidents, 3 system roles, top 5% of collaboration paths | "Same person, three signals: share the load before she burns out." |
| Knowledge islands | Data Engineering, Kubernetes, Billing Systems: experts all in one team while other divisions need them | "The expertise exists, but it is trapped." |
| Experts to re-engage | Kofi Nkosi, network architect: designs reused 23 times, nothing since late 2025, 70% free | "We are not short of experts; we stopped asking them." |
| Off-chart contributors | Grace Hughes, field coordinator: on no project roster, fixed 6 incidents on NOVA, OLT and telemetry, wrote 2 runbooks other teams reuse | "Her work is real; it just is not on any chart." |

Each card has **Show on graph**; only people who opted in to visibility are named.

**Growth paths:** open any person (e.g. search "Lim Wei Ling"): roles they can take now, and roles they are close to with the smallest path.

**3D Fly (optional wow, 30 s):** click **3D Fly** in the top bar (or open `/?view=3d`). The galaxy becomes strata: organisation on top, skills and people in the middle, work below, systems and customers at the base. Drag to orbit and tilt, right-drag to pan, scroll to zoom. Ask the same question: the camera flies to the team, with gold particles running along Hafiz's AI-inferred skills. If the laptop has no WebGL, the app falls back to 2D with a notice.

**Search:** press `/` (or click the search box), type a name, project or system (e.g. "NOVA"), use the arrow keys and Enter. The graph flies to it and the panel lists everything it connects to. Example walk-through (PRD 11.6): NOVA NMS → Network Test Lab → Hafiz Rahman.

**Shapes:** circle = person, square = project, hexagon = system, triangle = skill, pentagon = customer or partner, star = opportunity, octagon = incident, document = knowledge, ring = department or division. In 3D these become sphere, cube, hex prism, tetrahedron, dodecahedron, cone, icosahedron, slab and torus.

Other questions that work (all cached): "Build a team to deploy an AI customer-service solution." (83% coverage, 1 gap), "Find someone who can help me automate this network testing process." (Hafiz 89%), "Can we offer smart campus video analytics without hiring?", "Who has experience with this type of customer problem: enterprise VPN latency?", "Who has spare capacity to build a network telemetry data platform?" (Lisbon data engineer plus a Platform Engineer gap with 2 reskill options), "We need an AI-driven network optimisation solution."

Deep links (useful for the recording): `/?q=<question>`, `/?mode=` with `discover`, `talent`, `risk`, `bridges`, `bottlenecks`, `rising`, `islands`, `forgotten` or `ghosts`, `/?focus=SYS-NOVA`, and add `view=3d` to any of them (e.g. `/?view=3d&q=...`).

## After the demo

- In **Agents**, click **Reset agent demo** if any scenario was simulated.
- On `/value`, click **Reset demo records** (asks to confirm) so the next run starts at $1.50M.

## If something breaks

| Symptom | Fix |
|---|---|
| "The capability graph is not ready" | `cd app && npm run precompute -- --skip-llm --skip-embed` (rebuilds graph.json in about 3 s), then reload |
| Answers slow or failing | Restart with `LLM_MODE=cache-first` (step 5). Scripted questions never depend on the network |
| Panel shows "AI: template" | Gemini and the cache both missed; numbers are still correct (they come from the engine). Rerun `warm_cache.py` when back online |
| Graph blank or slow | Use Chrome with hardware acceleration on; otherwise play the backup video |
| Port 3012 busy | Stop the old node process, or run `npx next start -p 3013` |

## Rebuild everything from scratch (about 1 minute)

```
python data/generator/generate.py && python data/generator/validate.py && python data/generator/build_db.py
cd app && npm run precompute && npm test && npm run build && npm start
python ../tools/warm_cache.py
```
