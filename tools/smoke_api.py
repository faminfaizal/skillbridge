"""SkillBridge API smoke test against a running app (default http://localhost:3012). Prints what the demo will show."""
import json
import sys
import time
import urllib.request

B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3012"


def call(path, body=None, method=None):
    t = time.time()
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    return json.loads(urllib.request.urlopen(req, timeout=180).read()), time.time() - t


for _ in range(30):
    try:
        urllib.request.urlopen(B + "/api/opportunities", timeout=3)
        break
    except Exception:
        time.sleep(1)

g, t = call("/api/graph")
print(f"graph {len(g['nodes'])} nodes {len(g['edges'])} edges {t:.2f}s")
for q in ["We need to deliver an AI-powered customer analytics project.",
          "Build a team to deploy an AI customer-service solution.",
          "Can we help a hospital improve patient appointment reminders with chat?",
          "Where are our biggest capability gaps?",
          "Are we too reliant on a handful of people for billing?"]:
    d, t = call("/api/ask", {"query": q})
    if d["kind"] == "exec":
        print(f"\nEXEC {q[:55]} | {t:.1f}s provider={d['provider']} intent={d['intent']}\n  {d['headline']}")
        continue
    print(f"\nASK {q[:55]} | {t:.1f}s provider={d['provider']} opp={d['opportunityId']} coverage={d['coverage']}")
    print("  team:", [(c["name"], c["score"], c["hidden"]) for c in d["team"]])
    print("  gaps:", [(x["role"], [r["name"] for r in x["reskill"]]) for x in d["gaps"]])
    print("  value:", d["value"]["costAvoided"], d["value"]["productivity"], d["value"]["revenuePotential"],
          "| highlight", len(d["highlight"]["nodeIds"]), "nodes", len(d["highlight"]["edgeIds"]), "edges")
    print("  narrative:", d["narrative"][:320])
h, _ = call("/api/hidden-talent")
print("\nhidden talent:", [x["name"] for x in h[:3]])
r, _ = call("/api/risks")
print("risks:", [(x["name"], x["share"]) for x in r])
p, _ = call("/api/person/" + h[0]["personId"])
print("person:", p["name"], len(p["projects"]), "projects", len(p["inferred"]), "inferred skills")
w, _ = call("/api/whatif", {"removePersonIds": [x["id"] for x in r[0]["people"]]})
print("what-if:", [(s["name"], s["coverageLost"]) for s in w["systems"]], len(w["customers"]), "customers")
i, _ = call("/api/impact")
print("impact totals:", i["totals"])
dsc, t = call("/api/discover")
print(f"discovery: {len(dsc['cards'])} cards, ${dsc['totalValueAmt']:,} in {t:.2f}s:", sorted({c['type'] for c in dsc['cards']}))
print("growth paths:", p["name"], p["growth"])
