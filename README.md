# SkillBridge

**Your company already knows who can do the work. SkillBridge finds them, proves it with evidence, forms the team, and counts the value.**

SkillBridge is a capability intelligence platform for the future of work, built on Gemini and Google Cloud. It reads the work an organisation already records (projects, incidents, knowledge articles, documents and photos of them) to discover the skills people actually have, staffs new work from inside, plans the shortest reskilling path for any gap, redeploys people whose work AI takes over, mobilises the nearest qualified team after an incident, and measures every outcome in money, jobs kept and CO2e avoided.

**Live prototype:** https://veridane-skillbridge-1017.web.app

All data is synthetic. The demo organisation, Veridane Networks, is a fictional telecom and technology services company with 300 people.

## The problem

Organisations hire, buy consultancy and form teams without knowing what their own people can do. Job titles and HR records describe roles, not abilities. Finding an internal expert takes about 16 hours of asking around; with SkillBridge it takes about 15 minutes.

## What it does

| Capability | Description |
|---|---|
| Capability galaxy | A live WebGL graph of people, projects, systems and skills, clustered by real work rather than the org chart; 2D and 3D views |
| Ask | One sentence ("We need to deliver an AI-powered customer analytics project") becomes roles, the best internal people, gaps, reskilling paths and value |
| Hidden skills | Gemini infers skills from work records; every inference must cite evidence that exists in the data |
| Challenge Team | A manager swaps anyone in or out and sees the team match score move before activating |
| Reskilling | The smallest learning path to close a gap, time to readiness and hiring cost avoided |
| Opportunity discovery | Nine detectors surface revenue, avoidable consultancy spend, spare capacity, duplicated work and key-person risk |
| Executive intelligence | Seven executive questions answered as decisions, with a Gemini brief over engine facts |
| Five AI agents | Connectivity, People Growth, Opportunity Scout, Risk Sentinel and Concierge watch the data, propose actions and wait for human approval |
| Concierge | A Gemini function-calling agent over ten SkillBridge tools; answers that contain a figure the tools did not return are rejected |
| My Profile | Self-service profile with evidence, documents (Gemini reads uploaded CVs, certificates and even photos of them), privacy controls and a personal graph |
| Redeploy, don't retrench | When AI takes over a kind of work (the AI customer-service rollout exposes contact-centre roles), each person's nearest internal destination and smallest reskilling path; jobs kept, severance and hiring avoided |
| Incident response team | A situation report, typed or photographed, becomes a team ranked by role fit, distance and availability, compared with a skills-only search: hours to site, travel and CO2e avoided; the Risk Sentinel proposes, a person approves |
| Community skills exchange | Community and small-business requests matched to consenting volunteers, nearest first; approved hours are logged |
| Value ledger | Money plus social and environmental value (CO2e avoided, jobs kept, volunteer hours, remote-region opportunity), each with its basis; a grounded Gemini statement; a public live ledger in Firestore |
| Opportunity equity | Each location's share of the workforce against its share of the people proposed for open work, with remote offices and off-chart contributors made visible |
| Concierge memory | Follow-up questions ("and who could replace her?") use the conversation so far, stored per session in Firestore |

## How Gemini is used

| Use | Model role | Guardrail |
|---|---|---|
| Hidden-skill inference from work records | Fast | Evidence check: each inferred skill must quote a real record |
| Request parsing into roles and skills | Chat | Engine scores every candidate; the model never ranks people |
| Concierge agent (function calling) | Chat | Grounding check: no figure the tools did not return |
| Executive briefs and "why this person" explanations | Chat / fast | Written over engine facts only |
| Reading a photographed situation report into place, severity and roles (multimodal) | Chat | The engine staffs and scores; reported customer counts are shown, never used in money |
| Social and environmental impact statement | Fast | Every figure must appear in the ledger facts |
| Document reading: CVs, certificates and portfolios as PDF, or a photo or scan read directly (multimodal) | Fast | Each suggested skill must quote the document (its text layer, or what Gemini transcribed); the person confirms |
| Semantic matching | `gemini-embedding-001` | Same model and dimension for stored and query vectors |

Design principles: the deterministic engine decides and every number on screen comes from it; answers never go blank (live Gemini, then a golden cache, then templates); private profiles never appear in lenses or AI answers; agents propose and people decide.

## Google Cloud services

| Service | Use |
|---|---|
| Gemini on Vertex AI | All reasoning, extraction, document reading, explanations, function calling and embeddings (`gemini-3.5-flash`, `gemini-embedding-001`, via `@google/genai` with Application Default Credentials; no API keys) |
| Cloud Run | Hosts the Next.js application, the deterministic engine and the always-on agent runner (one instance, CPU always allocated) |
| Firebase Hosting | Public entry point and CDN in front of Cloud Run (`firebase.json` rewrite) |
| Firestore | Concierge conversation memory per session, the live value ledger (public `/ledger` page) and a mirror of the agents' proposal inbox and activity |
| BigQuery | Impact ledger, social ledger and skill coverage for analytics; the value dashboard queries value by quarter live |
| Pub/Sub | Domain events (simulations, incidents, community requests) published and pushed back to Cloud Run so the agents react |
| Cloud Build, Artifact Registry | Source-based container builds (`gcloud run deploy --source .`) |
| Secret Manager, IAM | The Pub/Sub push token; a least-privilege runtime service account (Vertex AI, Firestore, BigQuery, Pub/Sub, log writer) |

SQLite inside the image stays the engine's source of truth, so every instance starts from a clean demo state; cloud writes are fire-and-forget mirrors and events, and the app keeps working if any of them is unavailable.

## Run locally

Requirements: Node.js 22.13 or newer, Python 3.12 or newer, and for live AI a Google Cloud project with Vertex AI enabled.

```
python data/generator/generate.py          # deterministic synthetic data, seed 2026
python data/generator/validate.py          # 137 integrity and story checks
python data/generator/build_db.py
cd app
npm install
npm run precompute                         # Gemini inference + embeddings + graph layout
                                           # (--skip-llm --skip-embed runs without AI)
npm test                                   # 55 tests, run serially
npm run build && npm start                 # http://localhost:3012
```

For live Gemini: `gcloud auth application-default login`, copy `.env.example` to `.env`, set `GOOGLE_CLOUD_PROJECT` and the model IDs, then `npm run smoke` to check chat, fast, embeddings and function calling.

## Repository layout

| Path | Contents |
|---|---|
| `app/src/lib/engine/` | Deterministic scoring, team formation, reskilling, value, discovery, signals, executive answers |
| `app/src/lib/agents/` | The five agents, change log and triggers, inbox and approvals, Concierge tools |
| `app/src/lib/llm.ts` | The only module that calls Gemini: JSON answers, embeddings, function calling, cache and audit |
| `app/src/lib/me/`, `app/src/app/profile/` | My Profile |
| `app/scripts/` | Precompute (inference, embeddings, graph) and the Vertex AI smoke test |
| `data/generator/`, `data/seed/` | Synthetic data generator, story anchors, validation and generated seed |
| `docs/DEMO_RUNBOOK.md` | Demo script |
| `tools/` | API smoke test and golden-cache warm-up |
