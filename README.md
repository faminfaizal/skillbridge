# SkillBridge

**Your company already knows who can do the work. SkillBridge finds them, proves it with evidence, forms the team, and counts the value.**

SkillBridge is a capability intelligence platform built on Gemini and Google Cloud. It reads the work an organisation already records (projects, incidents, knowledge articles, documents) to discover the skills people actually have, staffs new work from inside, plans the shortest reskilling path for any gap, and measures the value of every internal match in money.

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
| My Profile | Self-service profile with evidence, documents (Gemini reads uploaded CVs and certificates), privacy controls and a personal graph |

## How Gemini is used

| Use | Model role | Guardrail |
|---|---|---|
| Hidden-skill inference from work records | Fast | Evidence check: each inferred skill must quote a real record |
| Request parsing into roles and skills | Chat | Engine scores every candidate; the model never ranks people |
| Concierge agent (function calling) | Chat | Grounding check: no figure the tools did not return |
| Executive briefs and "why this person" explanations | Chat / fast | Written over engine facts only |
| Document reading (CV, certificate, portfolio) | Fast | Each suggested skill must quote the document; the person confirms |
| Semantic matching | `gemini-embedding-001` | Same model and dimension for stored and query vectors |

Design principles: the deterministic engine decides and every number on screen comes from it; answers never go blank (live Gemini, then a golden cache, then templates); private profiles never appear in lenses or AI answers; agents propose and people decide.

## Google Cloud services

| Service | Use |
|---|---|
| Gemini on Vertex AI | All reasoning, extraction, explanations, function calling and embeddings (`@google/genai`, Application Default Credentials) |
| Cloud Run | Hosts the Next.js application, the engine and the agent runner |
| Firebase Hosting | Public entry point and CDN in front of Cloud Run |
| Cloud Storage | Database snapshots and uploaded documents |
| Cloud Build, Artifact Registry | Source-based container builds |
| Secret Manager | Service secrets |

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
