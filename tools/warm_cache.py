"""Warm the golden LLM cache: run every scripted demo question once against the live app (Gemini), so the demo still
works from cache if both AI providers fail. Also exercises Activate + reset. Usage: python tools/warm_cache.py [base_url]"""
import json
import sys
import urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3012"
QUERIES = [
    "We need to deliver an AI-powered customer analytics project.",
    "Build a team to deploy an AI customer-service solution.",
    "Find someone who can help me automate this network testing process.",
    "Can we offer smart campus video analytics without hiring?",
    "Who has experience with this type of customer problem: enterprise VPN latency?",
    "Who has spare capacity to build a network telemetry data platform?",
    "We need an AI-driven network optimisation solution.",
    "Find experts outside my department to support SME digital onboarding in Northern Territory.",
    # Executive Intelligence (PRD 4): the brief over each answer is cached too
    "Where are our biggest capability gaps?",
    "What are we paying external parties for that we already possess?",
    "Which skills become critical in 2 years?",
    "Where are we over-dependent on individuals?",
    "Which under-utilised capabilities could generate revenue?",
    "How much value did internal reuse create this quarter?",
    "Where should we invest the savings?",
    # Concierge agent (live tool calling; checks the gateway still accepts tool calls)
    "Who is rising fast, and is anything waiting for my approval?",
    "What happens if Priya Nair leaves?",
]


def post(path, body, method="POST"):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    return json.loads(urllib.request.urlopen(req, timeout=180).read())


for q in QUERIES:
    r = post("/api/ask", {"query": q})
    if r["kind"] == "exec":
        print(f"{r['provider']:10} {r['elapsedMs']:5}ms exec:{r['intent']:10}  {q}")
        continue
    if r["kind"] == "concierge":
        tools = [s["tool"] for s in r["steps"] if not s["tool"].endswith(("model", "check", "calling"))]
        print(f"{r['provider']:10} {r['elapsedMs']:5}ms concierge:{r['mode']} grounded={r['grounded']} tools={tools}  {q}")
        continue
    print(f"{r['provider']:10} {r['elapsedMs']:5}ms {r['opportunityId'] or '-':8} team={len(r['team'])} gaps={len(r['gaps'])}  {q}")
first = post("/api/ask", {"query": QUERIES[0]})
rec = post("/api/activate", {"opportunityId": first["opportunityId"], "title": first["opportunityTitle"],
                             "personIds": [c["personId"] for c in first["team"]], "value": first["value"]})
print("activate ->", rec["id"], rec["cost_avoided_amt"], rec["productivity_amt"], rec["revenue_amt"])
summary = json.loads(urllib.request.urlopen(B + "/api/impact").read())
print("dashboard total after activate:", summary["totals"]["total"])
print("reset ->", post("/api/impact", None, "DELETE"))
