"""Validate the generated seed: integrity, story anchors (story_manifest.json), realism, and a no-real-PII scan.

Usage: python data/generator/validate.py     exit 0 = all checks pass
Score-based outcomes (A1 87%, A5 team, A6 coverage, A7 readiness) are asserted by the app's engine tests.
"""
import collections
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

from generate import TABLE_ORDER
from config import LEVELS

SEED = Path(__file__).resolve().parent.parent / "seed"
fails, passes = [], 0


def load(t):
    with open(SEED / f"{t}.csv", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)


T = {t: load(t) for t in TABLE_ORDER}
ids = {t: {r["id"] for r in rows} for t, rows in T.items() if rows and "id" in rows[0]}
ids["skills"] = {r["id"] for r in T["skills"]}
people = {p["id"]: p for p in T["people"]}
manifest = {m["anchor"]: m["expected"] for m in json.loads((SEED / "story_manifest.json").read_text(encoding="utf-8"))}

# ---------------------------------------------------------------- integrity
FKS = [("people", "manager_id", "people"), ("people", "division_id", "divisions"), ("people", "department_id", "departments"),
       ("people", "team_id", "teams"), ("people", "location_id", "locations"), ("person_skills", "person_id", "people"),
       ("person_skills", "skill_id", "skills"), ("assignments", "person_id", "people"), ("assignments", "project_id", "projects"),
       ("projects", "customer_id", "organisations"), ("projects", "problem_class_id", "problem_classes"),
       ("project_skills", "skill_id", "skills"), ("project_systems", "system_id", "systems"), ("system_roles", "person_id", "people"),
       ("system_deps", "depends_on_id", "systems"), ("customer_cases", "resolver_id", "people"), ("customer_cases", "org_id", "organisations"),
       ("incidents", "system_id", "systems"), ("incident_resolvers", "incident_id", "incidents"), ("incident_resolvers", "person_id", "people"),
       ("knowledge_items", "author_id", "people"), ("knowledge_items", "project_id", "projects"), ("external_engagements", "vendor_org_id", "organisations"),
       ("opportunity_roles", "opportunity_id", "opportunities"), ("opportunity_role_skills", "role_id", "opportunity_roles"),
       ("opportunity_role_skills", "skill_id", "skills"), ("peer_recognition", "to_id", "people"), ("peer_recognition", "from_id", "people"),
       ("visibility_signals", "person_id", "people"), ("events", "person_id", "people"), ("sme_requests", "org_id", "organisations")]
for table, col, ref in FKS:
    bad = [r[col] for r in T[table] if r[col] and r[col] not in ids[ref]]
    check(not bad, f"FK {table}.{col} -> {ref}: {len(bad)} unresolved, e.g. {bad[:3]}")
for t, rows in T.items():
    if rows and "id" in rows[0]:
        check(len({r['id'] for r in rows}) == len(rows), f"duplicate ids in {t}")
check(sum(1 for p in T["people"] if not p["manager_id"]) == 1, "exactly one person (CEO) has no manager")
lv = collections.Counter(p["level"] for p in T["people"])
for code, _, _, count, _ in LEVELS:
    check(abs(lv[code] - count) <= 2, f"level {code}: {lv[code]} vs pyramid {count}")
check(len(T["people"]) == 300, f"people = {len(T['people'])}")

# ---------------------------------------------------------------- anchors
skill_name = {s["id"]: s["name"] for s in T["skills"]}
declared = collections.defaultdict(set)
for r in T["person_skills"]:
    declared[r["person_id"]].add(skill_name[r["skill_id"]])
asg_by_person = collections.defaultdict(list)
for a in T["assignments"]:
    asg_by_person[a["person_id"]].append(a)
projects = {p["id"]: p for p in T["projects"]}

m = manifest["A1"]
h = m["person_id"]
check(not (set(m["no_declared_skills"]) & declared[h]), "A1: Hafiz must not declare Python/Test Automation")
evidence = [a for a in asg_by_person[h] if "python" in a["contribution_note"].lower() or "pytest" in a["contribution_note"].lower()]
evidence += [k for k in T["knowledge_items"] if k["author_id"] == h and "python" in k["body"].lower()]
inc_ids = {r["incident_id"] for r in T["incident_resolvers"] if r["person_id"] == h}
evidence += [i for i in T["incidents"] if i["id"] in inc_ids and ("python" in i["summary"].lower() or "script" in i["summary"].lower())]
check(len(evidence) >= m["evidence_min"], f"A1: Hafiz evidence {len(evidence)} < {m['evidence_min']}")

m = manifest["A2"]
pr = m["person_id"]
check(len({a["project_id"] for a in asg_by_person[pr]}) == m["projects"], "A2: Priya project count")
rec = [r for r in T["peer_recognition"] if r["to_id"] == pr]
check(len(rec) >= m["recognition_min"], f"A2: Priya recognition {len(rec)}")
check(sum(1 for v in T["visibility_signals"] if v["person_id"] == pr) <= m["visibility_max"], "A2: Priya visibility")
areas = {k["system_id"] for k in T["knowledge_items"] if k["author_id"] == pr}
check(len(areas) >= m["critical_knowledge_areas"], f"A2: Priya knowledge areas {len(areas)}")
ev = [e for e in T["events"] if e["person_id"] == pr]
check(sum(e["date"] >= "2026-01-01" for e in ev) > sum(e["date"] < "2026-01-01" for e in ev), "A2: Priya contribution rising")
check(people[pr]["consent_visibility"] == "1", "A2: Priya consent")

m = manifest["A3"]
rate_inc = {i["id"] for i in T["incidents"] if i["system_id"] == m["system_id"]}
credits = [r["person_id"] for r in T["incident_resolvers"] if r["incident_id"] in rate_inc]
share = sum(c in m["people"] for c in credits) / len(credits)
check(abs(share - m["share"]) <= m["tolerance"], f"A3: share {share:.3f}")
check(sum(int(people[x]["hire_year"]) < 2000 for x in m["people"]) == m["hired_before_2000"], "A3: two hired before 2000")
check(sum(people[x]["retirement_risk"] == "1" for x in m["people"]) == m["retirement_risk"], "A3: retirement risk")

m = manifest["A4"]
ext = {e["id"]: e for e in T["external_engagements"]}
check(all(x in ext for x in m["engagements"]), "A4: engagements exist")
spend_keys = [(e["project_id"], e["skill_id"]) for e in T["external_engagements"]]
check(len(spend_keys) == len(set(spend_keys)), "A4: no engagement recorded twice for the same project and skill")
for pid in m["internal_people"]:
    for e in m["engagements"]:
        start = ext[e]["start_date"]
        load_ = sum(int(a["allocation_pct"]) for a in asg_by_person[pid] if a["start_date"] <= start <= a["end_date"])
        check(load_ < m["max_allocation"], f"A4: {pid} allocation {load_}% during {e}")

m = manifest["A5"]
opp = {o["id"]: o for o in T["opportunities"]}["OPP-001"]
check(int(opp["external_quote_amt"]) - int(opp["internal_cost_amt"]) == m["cost_avoided_amt"], "A5: cost avoided")
check(int(opp["hours_saved"]) * 100 == m["productivity_amt"], "A5: productivity (hours x blended $100)")
check(int(opp["revenue_potential_amt"]) == m["revenue_potential_amt"], "A5: revenue potential")
holders = [p for p, s in declared.items() if {"MLOps", "Model Monitoring"} & s]
check(not holders, f"A5: gap skills held by {holders[:3]}")

m = manifest["A8"]
fibre = next(p["id"] for p in T["problem_classes"] if p["name"] == m["problem"])
mine = [c for c in T["customer_cases"] if c["resolver_id"] == m["person_id"] and c["problem_class_id"] == fibre]
peers = [float(c["mttr_hours"]) for c in T["customer_cases"] if c["problem_class_id"] == fibre and c["resolver_id"] != m["person_id"] and c["severity"] == "P2"]
check(len(mine) == m["cases"], "A8: Joseph fibre cases")
check(not peers or max(float(c["mttr_hours"]) for c in mine) < sum(peers) / len(peers), "A8: Joseph faster than peers")
check(people[m["person_id"]]["location_id"] == m["location"], "A8: Joseph in Darwin")

m = manifest["A9"]
de = [p for p in T["people"] if p["department_id"] == m["department"] and p["location_id"] == m["location"]]
check(de and sum(int(p["availability_pct"]) for p in de) / len(de) >= m["availability_min"], "A9: Lisbon DE spare capacity")

m = manifest["A10"]
members = collections.defaultdict(set)
for a in T["assignments"]:
    members[a["project_id"]].add(a["person_id"])
shared = [pid for pid, ms in members.items() if any(people[x]["department_id"] == m["department"] for x in ms)
          and any(people[x]["division_id"] == m["division"] for x in ms)]
check(len(shared) == m["shared_projects"], f"A10: shared projects {shared}")

m = manifest["A11"]
pcs = {p["id"] for p in T["problem_classes"] if p["name"] in ("Smart campus security", "Video analytics demand")}
signals = sum(c["problem_class_id"] in pcs for c in T["customer_cases"]) + sum(
    o["id"] in ("OPP-004", "OPP-012") for o in T["opportunities"])
check(signals >= m["demand_signals_min"], f"A11: demand signals {signals}")
check(len({people[x]["team_id"] for x in m["holders"]}) == 3, "A11: holders in 3 different teams")

m = manifest["A12"]
k = {x["id"]: x for x in T["knowledge_items"]}
check(all(x in k for x in m["knowledge"]), "A12: churn knowledge items")
check(projects[m["projects"][0]]["division_id"] != projects[m["projects"][1]]["division_id"], "A12: different divisions")

m = manifest["A13"]
vpn = next(p["id"] for p in T["problem_classes"] if p["name"] == "Enterprise VPN latency")
vc = [c for c in T["customer_cases"] if c["problem_class_id"] == vpn and c["summary"].startswith("Enterprise VPN latency:")]
exp = [float(c["mttr_hours"]) for c in vc if c["resolver_id"] in m["experts"]]
oth = [float(c["mttr_hours"]) for c in vc if c["resolver_id"] not in m["experts"] and c["escalated"] == "1"]
check(exp and max(exp) <= m["expert_mttr_max"], "A13: experts fast")
check(oth and min(oth) >= m["other_mttr_min"], "A13: others slow")

m = manifest["A14"]
ps = collections.defaultdict(set)
for r in T["project_systems"]:
    ps[r["project_id"]].add(r["system_id"])
check(all(m["system_id"] in ps[x] for x in m["projects"]), "A14: projects A and C use NOVA")
check(any(i["id"] == m["incident"] and i["system_id"] == m["system_id"] for i in T["incidents"]), "A14: INC-042 on NOVA")
check(any(d["system_id"] == m["linked_system"] and d["depends_on_id"] == m["system_id"] for d in T["system_deps"]), "A14: Network Test Lab linked")
check({s["id"]: s for s in T["systems"]}[m["system_id"]]["vendor_org_id"] == m["vendor"], "A14: vendor")
check(any(r["system_id"] == m["system_id"] and r["person_id"] == m["maintainer"] for r in T["system_roles"]), "A14: maintainer")

m = manifest["A15"]
imp = T["impact_records"]
check(len(imp) == m["records"], "A15: record count")
for col, key in (("cost_avoided_amt", "cost_avoided_amt"), ("productivity_amt", "productivity_amt"), ("recruitment_amt", "recruitment_amt"), ("revenue_amt", "revenue_amt")):
    check(sum(int(r[col]) for r in imp) == m[key], f"A15: {col} sum")
check(sum(int(r["allocation_amt"]) for r in T["reinvestment_initiatives"]) == m["total_amt"], "A15: initiatives sum to $1.50M")

m = manifest["A17"]
opted = sum(p["consent_visibility"] == "0" for p in T["people"])
check(m["opted_out_min"] <= opted <= m["opted_out_max"], f"A17: opted out {opted}")
check(people[m["opted_out_star"]]["consent_visibility"] == "0", "A17: star is opted out")

m = manifest["A18"]
check(len(T["sme_requests"]) == m["requests"], "A18: SME requests")
check("LoRaWAN" in declared[m["regional_match"]], "A18: Joseph holds LoRaWAN")

m = manifest["A19"]
check(sum(int(k["reuse_count"]) for k in T["knowledge_items"] if k["author_id"] == m["person_id"]) >= m["reuse_min"], "A19: designs reused")
check(sum(e["person_id"] == m["person_id"] and e["date"] >= "2026-01-01" for e in T["events"]) == m["events_2026"], "A19: no 2026 activity")
check(not any(a["person_id"] == m["person_id"] and a["end_date"] >= "2026-01-01" for a in T["assignments"]), "A19: no active project")

m = manifest["A20"]
check(sum(a["person_id"] == m["person_id"] for a in T["assignments"]) == m["assignments"], "A20: on no project roster")
check(not any(r["person_id"] == m["person_id"] for r in T["system_roles"]), "A20: holds no system role")
check(sum(r["person_id"] == m["person_id"] for r in T["incident_resolvers"]) >= m["incidents_min"], "A20: fixes other teams' incidents")
check(sum(r["to_id"] == m["person_id"] and bool(r["project_id"]) for r in T["peer_recognition"]) >= m["recognition_min"], "A20: recognised by other projects")

# ---------------------------------------------------------------- realism
per_level = collections.defaultdict(list)
for p in T["people"]:
    per_level[p["level"]].append(len(declared[p["id"]]))
for code, vals in per_level.items():
    avg = sum(vals) / len(vals)
    check(3 <= avg <= 16, f"realism: avg skills for {code} = {avg:.1f}")
alloc = collections.Counter(a["allocation_pct"] for a in T["assignments"])
check(all(5 <= int(x) <= 70 for x in alloc), "realism: allocation range")
sev = collections.defaultdict(list)
for c in T["customer_cases"]:
    sev[c["severity"]].append(float(c["mttr_hours"]))
check(sum(sev["P1"]) / len(sev["P1"]) < sum(sev["P4"]) / len(sev["P4"]), "realism: P1 resolved faster than P4")
top_skills = sorted(declared, key=lambda x: -len(declared[x]))[:5]
check(manifest["A1"]["person_id"] not in top_skills and manifest["A2"]["person_id"] not in top_skills, "realism: anchors not top by skill count")

# ---------------------------------------------------------------- PII scan
NRIC = re.compile(r"\b\d{6}-\d{2}-\d{4}\b")
PHONE = re.compile(r"(\+?6?01\d[- ]?\d{3,4}[- ]?\d{4})")
EMAIL = re.compile(r"[\w.+-]+@([\w-]+\.)+[\w-]+")
hits = []
for t, rows in T.items():
    for r in rows:
        for v in r.values():
            if NRIC.search(v) or PHONE.search(v):
                hits.append((t, v[:40]))
            for mm in EMAIL.finditer(v):
                if not mm.group(0).endswith(".example"):
                    hits.append((t, mm.group(0)))
check(not hits, f"PII: {hits[:5]}")
check("ethnicity" not in T["people"][0] and "gender" not in T["people"][0] and "birth" not in "".join(T["people"][0]), "PII: no sensitive columns")

# ---------------------------------------------------------------- checksum
digest = hashlib.sha256()
for t in TABLE_ORDER:
    digest.update((SEED / f"{t}.csv").read_bytes())
check(digest.hexdigest() == (SEED / "checksum.txt").read_text().strip(), "checksum matches seed files")

print(f"{passes} checks passed, {len(fails)} failed")
for f in fails:
    print("  FAIL", f)
sys.exit(1 if fails else 0)
