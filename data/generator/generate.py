"""Generate the SkillBridge synthetic dataset (fictional company, no real personal data).

Usage: python data/generator/generate.py   -> data/seed/*.csv, story_manifest.json, finance_params.json
Deterministic: fixed seed in config.SEED.
"""
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path

import anchors
from config import (C_SUITE, DIVISION_EXEC, DIVISIONS, EMAIL_DOMAIN, FINANCE, GM_SEATS, LEVEL_LABEL, LEVEL_RANK,
                    LEVEL_RATE, LEVELS, LOCATIONS, TODAY)
from names import RESERVED_DRAWS, display_name, draw_name, email_for
from taxonomy import (ADJACENCY, ARCHETYPES, CERTIFICATIONS, GAP_SKILLS, LEADERSHIP_SKILLS, ORGANISATIONS,
                      PROBLEM_CLASSES, PROJECT_TEMPLATES, RECOGNITION_QUESTIONS, REGIONS, ANALYTICS_TOPICS,
                      SKILL_BY_NAME, SKILL_FAMILIES, SKILLS, SYSTEM_DEPS, SYSTEMS, TRAININGS, VISIBILITY_KINDS)
from world import World

ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = ROOT / "seed"
NAME_BY_ID = {sid: n for sid, n, _, _ in SKILLS}
EAST = {loc for loc, _, _, east in LOCATIONS if east}
LEVEL_BASE = {"C": 3, "GM": 3, "SM": 4, "M": 4, "AM": 4, "SE": 3, "E": 2, "A": 2}
HIRE_RANGE = {"C": (1995, 2012), "GM": (1996, 2012), "SM": (1998, 2015), "M": (2003, 2018), "AM": (2008, 2021),
              "SE": (2010, 2023), "E": (2016, 2025), "A": (2021, 2026)}


def pid_of(p):
    return p["id"]


# ---------------------------------------------------------------- org
def build_org(w):
    for loc_id, name, region, east in LOCATIONS:
        w.add("locations", id=loc_id, name=name, region=region, remote_region=east)
    for div_id, code, name, _, deps in DIVISIONS:
        w.add("divisions", id=div_id, code=code, name=name)
        for dep_id, dep_name, locs in deps:
            w.add("departments", id=dep_id, division_id=div_id, name=dep_name)
    for dt_row in DIVISIONS:
        for dep_id, dep_name, locs in dt_row[4]:
            for i, loc in enumerate(sorted(locs, key=lambda k: -locs[k])):
                w.add("teams", id=f"TEAM-{dep_id[4:]}-{i + 1}", department_id=dep_id,
                      name=f"{dep_name} {w.by_id('locations')[loc]['name']}", location_id=loc)


def largest_remainder(total, weights):
    s = sum(weights.values())
    raw = {k: total * v / s for k, v in weights.items()}
    out = {k: int(math.floor(x)) for k, x in raw.items()}
    for k in sorted(raw, key=lambda k: (-(raw[k] - out[k]), k))[: total - sum(out.values())]:
        out[k] += 1
    return out


def new_person(w, level, title, archetype, div, dep, team, loc, manager=None):
    drawn = w.__dict__.setdefault("name_draws", set())
    draw = draw_name(w.rng, loc in EAST)
    while draw in RESERVED_DRAWS or draw in drawn:
        draw = draw_name(w.rng, loc in EAST)
    drawn.add(draw)
    name = display_name(draw, {p["name"] for p in w.rows("people")})
    lo, hi = HIRE_RANGE[level]
    hire = w.rng.randint(lo, hi)
    return w.add("people", id=w.next_id("P", 3), name=name, email=email_for(name, w.emails, EMAIL_DOMAIN), level=level,
                 level_rank=LEVEL_RANK[level], title=title, archetype=archetype, division_id=div, department_id=dep,
                 team_id=team, manager_id=manager, location_id=loc, hire_year=hire,
                 availability_pct=w.rng.choice([10, 15, 20, 20, 25, 30, 35, 40]), loaded_rate_amt=LEVEL_RATE[level],
                 consent_visibility=1, retirement_risk=1 if hire < 1999 and LEVEL_RANK[level] <= 4 and w.rng.random() < .5 else 0)


def title_for(level, stem, dep_name, div_name):
    return {"GM": f"General Manager, {div_name}", "SM": f"Head of {dep_name}", "M": f"{dep_name} Manager",
            "AM": f"{stem} Lead", "SE": f"Senior {stem}", "E": stem,
            "A": "Technician" if "Engineer" in stem else f"Associate {stem}"}[level]


def build_people(w):
    divs = {d[0]: d for d in DIVISIONS}
    teams_by_dep = {}
    for t in w.rows("teams"):
        teams_by_dep.setdefault(t["department_id"], []).append(t)

    # C-suite
    csuite = {}
    for title, div in C_SUITE:
        p = new_person(w, "C", title, "Executive", div, None, None, "LOC-SIN")
        csuite[title] = p
    ceo = csuite["Group Chief Executive Officer"]
    for p in csuite.values():
        if p is not ceo:
            p["manager_id"] = ceo["id"]

    # level counts per division (excluding C-suite), allocated level by level so totals match the pyramid
    cs_in = {d: sum(1 for _, dv in C_SUITE if dv == d) for d in divs}
    cap = {d: divs[d][3] - cs_in[d] - GM_SEATS[d] for d in divs}
    alloc = {d: {"GM": GM_SEATS[d]} for d in divs}
    rest_levels = [lv for lv in LEVELS if lv[0] not in ("C", "GM")]
    for i, (code, _, _, count, _) in enumerate(rest_levels):
        if i == len(rest_levels) - 1:
            for d in divs:
                alloc[d][code] = cap[d]
            break
        share = largest_remainder(count, {d: max(cap[d], 0) for d in divs})
        for d in divs:
            share[d] = min(share[d], cap[d])
            alloc[d][code] = share[d]
            cap[d] -= share[d]

    for d, (_, code, div_name, _, deps) in divs.items():
        dep_ids = [x[0] for x in deps]
        dep_names = {x[0]: x[1] for x in deps}
        gms = [new_person(w, "GM", f"General Manager, {div_name}", "General Manager", d, None, None, "LOC-SIN",
                          csuite[DIVISION_EXEC[d]]["id"]) for _ in range(alloc[d]["GM"])]
        # spread the remaining people across departments
        n = sum(v for k, v in alloc[d].items() if k != "GM")
        dep_weight = {dep: (0.55 if dep == "DEP-LAB" else 1.0) for dep in dep_ids}
        dep_size = largest_remainder(n, dep_weight)
        pool = []
        for code_l in ["SM", "M", "AM", "SE", "E", "A"]:
            pool += [code_l] * alloc[d][code_l]
        # deal levels round-robin into departments, heads first
        dep_levels = {dep: [] for dep in dep_ids}
        order = sorted(dep_ids, key=lambda x: -dep_size[x])
        idx = 0
        for lv in pool:
            for _ in range(len(order)):
                dep = order[idx % len(order)]
                idx += 1
                if len(dep_levels[dep]) < dep_size[dep]:
                    dep_levels[dep].append(lv)
                    break
        for gi, dep in enumerate(order):
            stem = ARCHETYPES[dep][0]
            teams = teams_by_dep[dep]
            members = []
            for j, lv in enumerate(sorted(dep_levels[dep], key=lambda x: LEVEL_RANK[x])):
                team = None if lv == "SM" else teams[j % len(teams)]
                loc = team["location_id"] if team else teams[0]["location_id"]
                members.append(new_person(w, lv, title_for(lv, stem, dep_names[dep], div_name), stem, d, dep,
                                          team["id"] if team else None, loc))
            # reporting lines: head -> GM; everyone else -> nearest more senior person in the department
            head = members[0]
            head["manager_id"] = gms[gi % len(gms)]["id"]
            for m in members[1:]:
                seniors = [x for x in members if x["level_rank"] < m["level_rank"]]
                if not seniors:
                    m["manager_id"] = head["id"]
                    continue
                best = max(x["level_rank"] for x in seniors)
                cands = [x for x in seniors if x["level_rank"] == best]
                same_team = [x for x in cands if x["team_id"] == m["team_id"]] or cands
                m["manager_id"] = same_team[int(m["id"][2:]) % len(same_team)]["id"]
    # privacy: ~5% opt out of visibility (A17); anchors re-assert their own flags later
    people = [p for p in w.rows("people") if p["level"] not in ("C", "GM")]
    for p in w.rng.sample(people, 15):
        p["consent_visibility"] = 0


# ---------------------------------------------------------------- skills
def build_skills(w):
    for sid, name, fam, emerging in SKILLS:
        w.add("skills", id=sid, name=name, family=fam, emerging=emerging)
    seen = set()
    for a, b, wt in ADJACENCY:
        for x, y in ((a, b), (b, a)):
            seen.add((x, y))
            w.add("skill_adjacency", skill_a=SKILL_BY_NAME[x], skill_b=SKILL_BY_NAME[y], weight=wt)
    for fam, names in SKILL_FAMILIES.items():
        for i, a in enumerate(names):
            for b in names[i + 1:i + 3]:
                for x, y in ((a, b), (b, a)):
                    if (x, y) not in seen:
                        seen.add((x, y))
                        w.add("skill_adjacency", skill_a=SKILL_BY_NAME[x], skill_b=SKILL_BY_NAME[y], weight=0.35)


def build_person_skills(w):
    for p in w.rows("people"):
        lv = p["level"]
        if lv == "C":
            for s in w.rng.sample(LEADERSHIP_SKILLS, 4) + ["Strategic Planning"]:
                w.set_skill(p["id"], s, w.rng.choice([4, 5]), "declared", 2026)
            continue
        dep = p["department_id"] or {"DIV-NI": "DEP-CORE", "DIV-EG": "DEP-ENT", "DIV-CR": "DEP-MKT", "DIV-CSO": "DEP-CC",
                                      "DIV-ITD": "DEP-APP", "DIV-ADL": "DEP-DS", "DIV-CF": "DEP-STR"}[p["division_id"]]
        _, core, optional = ARCHETYPES[dep]
        base = LEVEL_BASE[lv]
        for s in core:
            w.set_skill(p["id"], s, max(1, min(5, base + w.rng.choice([-1, 0, 0, 1]))),
                        w.rng.choice(["declared"] * 7 + ["cv"] * 3), w.rng.choice([2025, 2026, 2026]))
        for s, prob in optional.items():
            if w.rng.random() < prob:
                w.set_skill(p["id"], s, max(1, min(5, base - 1 + w.rng.choice([-1, 0, 0, 1]))),
                            w.rng.choice(["declared", "cv"]), w.rng.choice([2023, 2024, 2025, 2026]))
        n_lead = {"GM": 4, "SM": 3, "M": 3, "AM": 2}.get(lv, 0)
        for s in w.rng.sample(LEADERSHIP_SKILLS, n_lead):
            w.set_skill(p["id"], s, w.rng.choice([3, 4, 4, 5]), "declared", 2026)
    # gap skills: nobody holds them at working level (creates the A5/A6 gaps)
    gap_ids = {SKILL_BY_NAME[s] for s in GAP_SKILLS}
    w.t["person_skills"] = [r for r in w.rows("person_skills") if r["skill_id"] not in gap_ids]


def build_learning(w):
    for cid, name, skill, cost, months in CERTIFICATIONS:
        w.add("certifications", id=cid, name=name, skill_id=SKILL_BY_NAME[skill], cost_amt=cost, months=months)
    for tid, name, skill, kind, cost, weeks in TRAININGS:
        w.add("trainings", id=tid, name=name, skill_id=SKILL_BY_NAME[skill], kind=kind, cost_amt=cost, weeks=weeks)
    certs_by_skill = {SKILL_BY_NAME[s]: cid for cid, _, s, _, _ in CERTIFICATIONS}
    short = [(tid, SKILL_BY_NAME[s]) for tid, _, s, kind, _, _ in TRAININGS if kind == "short"]
    for p in w.rows("people"):
        if p["id"] in w.locked:
            continue
        for sid, r in w.skills_of(p["id"]).items():
            if sid in certs_by_skill and r["level"] >= 3 and w.rng.random() < 0.35:
                w.add("person_certs", person_id=p["id"], cert_id=certs_by_skill[sid], year=w.rng.choice([2021, 2022, 2023, 2024, 2025]))
                r["source"] = "cert"
        for tid, sid in w.rng.sample(short, 2):
            if w.rng.random() < 0.6 and sid not in {SKILL_BY_NAME[s] for s in GAP_SKILLS}:
                w.add("enrolments", person_id=p["id"], training_id=tid, year=w.rng.choice([2024, 2025, 2026]),
                      status=w.rng.choice(["completed", "completed", "in progress"]))


# ---------------------------------------------------------------- reference data
def build_reference(w):
    for i, (name, domain) in enumerate(PROBLEM_CLASSES, 1):
        w.add("problem_classes", id=f"PC-{i:02d}", name=name, domain=domain)
    for oid, name, kind, sector, loc in ORGANISATIONS:
        w.add("organisations", id=oid, name=name, kind=kind, sector=sector, location_id=loc)
    for sid, name, kind, crit, loc, vendor, desc in SYSTEMS:
        w.add("systems", id=sid, name=name, kind=kind, criticality=crit, location_id=loc, vendor_org_id=vendor, description=desc)
    for a, b in SYSTEM_DEPS:
        w.add("system_deps", system_id=a, depends_on_id=b)


def pc_id(w, name):
    return next(r["id"] for r in w.rows("problem_classes") if r["name"] == name)


SYSTEM_OWNER_DEPS = {
    "SYS-NOVA": ["DEP-OSS", "DEP-CORE"], "SYS-ALAB": ["DEP-LAB"], "SYS-OLTM": ["DEP-ACC", "DEP-LAB"], "SYS-RATE": ["DEP-BSS"],
    "SYS-BILL": ["DEP-BSS"], "SYS-MED": ["DEP-BSS"], "SYS-CRM": ["DEP-APP"], "SYS-ORD": ["DEP-BSS"], "SYS-INV": ["DEP-OSS"],
    "SYS-DLK": ["DEP-DE"], "SYS-C360": ["DEP-DE", "DEP-MKT"], "SYS-CCP": ["DEP-CC"], "SYS-FSA": ["DEP-FSD"],
    "SYS-SDW": ["DEP-CORE"], "SYS-MPLS": ["DEP-CORE"], "SYS-DWDM": ["DEP-CORE"], "SYS-RAN": ["DEP-CORE", "DEP-MOB"],
    "SYS-K8S": ["DEP-CLD"], "SYS-CICD": ["DEP-CLD"], "SYS-OBS": ["DEP-CLD"], "SYS-SIEM": ["DEP-SEC"], "SYS-IAM": ["DEP-SEC"],
    "SYS-EPT": ["DEP-APP"], "SYS-APP": ["DEP-APP"], "SYS-POS": ["DEP-RET"], "SYS-RAT": ["DEP-BSS", "DEP-FIN"],
    "SYS-PAY": ["DEP-APP"], "SYS-HRS": ["DEP-HR"], "SYS-ERP": ["DEP-FIN"], "SYS-IOT": ["DEP-PRE"], "SYS-VAE": ["DEP-AIP"],
    "SYS-EDGE": ["DEP-CLD"], "SYS-BOT": ["DEP-AIP", "DEP-CC"], "SYS-TELE": ["DEP-DE"], "SYS-ML": ["DEP-DS"],
}


def build_system_roles(w):
    for sid, deps in SYSTEM_OWNER_DEPS.items():
        if any(r["system_id"] == sid for r in w.rows("system_roles")):
            continue  # anchors already set owners
        cands = [p for p in w.rows("people") if p["department_id"] in deps and p["id"] not in w.locked
                 and p["level"] in ("M", "AM", "SE", "E")]
        for i, p in enumerate(w.rng.sample(cands, min(len(cands), w.rng.randint(4, 7)))):
            w.add("system_roles", system_id=sid, person_id=p["id"], role="owner" if i == 0 else w.rng.choice(["maintainer", "maintainer", "sme"]))


# ---------------------------------------------------------------- projects and assignments
VERBS = ["Delivered", "Built", "Configured", "Designed", "Led", "Tested", "Automated", "Analysed", "Documented", "Coordinated"]


def note_for(w, person, skills, project_name, stretch=None):
    known = [s for s in skills if SKILL_BY_NAME[s] in w.skills_of(person["id"])] or skills[:1]
    s = w.rng.choice(known)
    text = f"{w.rng.choice(VERBS)} {s.lower()} work for {project_name}"
    if stretch:
        text += f"; also picked up {stretch} to unblock the team"
    return text


def eligible_people(w, division, exclude_divs=()):
    return [p for p in w.rows("people") if p["level"] in ("M", "AM", "SE", "E", "A") and p["id"] not in w.locked
            and p["division_id"] not in exclude_divs and (division is None or p["division_id"] == division)]


def staff_project(w, proj, skills, size, start, end, forbid=()):
    """Pick people by skill overlap. forbid: (deptA, divisionB) pairs that must not meet (A10 collaboration gap)."""
    sk_ids = {SKILL_BY_NAME[s] for s in skills}
    home = eligible_people(w, proj["division_id"])
    others = eligible_people(w, None)
    others = [p for p in others if p["division_id"] != proj["division_id"]]

    def fit(p):
        mine = w.skills_of(p["id"])
        return sum(mine[s]["level"] for s in sk_ids if s in mine) + w.rng.random() * 2

    n_cross = max(0, round(size * 0.25)) if w.rng.random() < 0.5 else 0
    team = sorted(home, key=fit, reverse=True)[: size * 2]
    team = w.rng.sample(team, min(len(team), size - n_cross))
    cross = [p for p in sorted(others, key=fit, reverse=True)[:12] if fit(p) > 3]
    team += w.rng.sample(cross, min(len(cross), n_cross))
    for a_dep, b_div in forbid:
        has_a = any(p["department_id"] == a_dep for p in team)
        team = [p for p in team if not (has_a and p["division_id"] == b_div)]
    days = (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days
    for i, p in enumerate(team):
        alloc = w.rng.choice([20, 25, 30, 40, 50, 60])
        mine = w.skills_of(p["id"])
        stretch = None
        if w.rng.random() < 0.10:
            adj = [r for r in w.rows("skill_adjacency") if r["skill_a"] in mine and r["skill_b"] not in mine and r["weight"] >= 0.55]
            if adj:
                stretch = NAME_BY_ID[w.rng.choice(adj)["skill_b"]]
        role = "Project Manager" if p["id"] == proj["pm_id"] else w.rng.choice(skills)
        w.add("assignments", id=w.next_id("ASG"), project_id=proj["id"], person_id=p["id"], role=role, allocation_pct=alloc,
              man_days=max(5, int(days * alloc / 100 * 0.7)), contribution_note=note_for(w, p, skills, proj["name"], stretch),
              start_date=start, end_date=end)
    return team


def status_for(start, end):
    if end < TODAY:
        return "completed"
    return "active" if start <= TODAY else "planned"


def build_projects(w, n_background=56):
    customers = [o for o in w.rows("organisations") if o["kind"] == "customer"]
    counters = {}
    for _ in range(n_background):
        name_t, ptype, div, skills, systems, pc, (lo, hi) = w.rng.choice(PROJECT_TEMPLATES)
        counters[name_t] = counters.get(name_t, 0) + 1
        cust = w.rng.choice(customers) if "{customer}" in name_t else None
        name = name_t.format(region=w.rng.choice(REGIONS), n=f"{2023 + counters[name_t] % 4}.{counters[name_t]}",
                             customer=cust["name"] if cust else "", topic=w.rng.choice(ANALYTICS_TOPICS))
        start = w.rand_date("2023-01-01", "2026-08-31")
        end = (dt.date.fromisoformat(start) + dt.timedelta(days=w.rng.randint(60, 300))).isoformat()
        leaders = [p for p in w.rows("people") if p["division_id"] == div and p["level"] in ("GM", "SM")]
        pms = [p for p in w.rows("people") if p["division_id"] == div and p["level"] in ("M", "AM") and p["id"] not in w.locked]
        budget = w.rng.choice([150, 250, 400, 600, 900, 1500]) * 1000
        proj = w.add("projects", id=w.next_id("PRJ", 3), code="", name=name, type=ptype, division_id=div,
                     sponsor_id=w.rng.choice(leaders)["id"], pm_id=w.rng.choice(pms)["id"], status=status_for(start, end),
                     start_date=start, end_date=end, budget_amt=budget,
                     external_spend_amt=int(budget * w.rng.choice([0, 0, 0, .1, .2, .35])), outcome="",
                     value_amt=int(budget * w.rng.uniform(.8, 2.5)), customer_id=cust["id"] if cust else None,
                     problem_class_id=pc_id(w, pc), location_id=None, description=f"{ptype.capitalize()} project: {name}.")
        proj["code"] = proj["id"].replace("PRJ", "P")
        proj["outcome"] = {"completed": w.rng.choice(["Delivered on time", "Delivered with minor delay", "Delivered under budget"]),
                           "active": "In delivery", "planned": "Planned"}[proj["status"]]
        for s in skills:
            w.add("project_skills", project_id=proj["id"], skill_id=SKILL_BY_NAME[s])
        for s in systems:
            w.add("project_systems", project_id=proj["id"], system_id=s)
        staff_project(w, proj, skills, w.rng.randint(lo, hi), start, end, forbid=[("DEP-ENT", "DIV-ADL")])


def fill_unassigned(w):
    """Everyone below senior management works on at least one project in their own division (best skill fit)."""
    assigned = {a["person_id"] for a in w.rows("assignments")}
    ps = {}
    for r in w.rows("project_skills"):
        ps.setdefault(r["project_id"], set()).add(r["skill_id"])
    for p in w.rows("people"):
        if p["id"] in assigned or p["id"] in w.locked or p["level"] in ("C", "GM", "SM"):
            continue
        mine = w.skills_of(p["id"])
        projs = [x for x in w.rows("projects") if x["division_id"] == p["division_id"]]
        if not projs:
            continue
        best = max(projs, key=lambda x: (len(ps.get(x["id"], set()) & set(mine)), w.rng.random()))
        skills = sorted(ps.get(best["id"], set()) & set(mine)) or sorted(mine)[:1]
        days = (dt.date.fromisoformat(best["end_date"]) - dt.date.fromisoformat(best["start_date"])).days
        alloc = w.rng.choice([15, 20, 25, 30, 40])
        role = NAME_BY_ID[skills[0]] if skills else "Contributor"
        w.add("assignments", id=w.next_id("ASG"), project_id=best["id"], person_id=p["id"], role=role, allocation_pct=alloc,
              man_days=max(5, int(days * alloc / 100 * 0.7)),
              contribution_note=f"{w.rng.choice(VERBS)} {role.lower()} tasks for {best['name']}",
              start_date=best["start_date"], end_date=best["end_date"])


# ---------------------------------------------------------------- service and ops
CASE_DEPS = {"Network": ["DEP-ESC", "DEP-FOC", "DEP-FOR", "DEP-ACC"], "BSS/OSS": ["DEP-BSS", "DEP-CC"],
             "CX & Service": ["DEP-CC", "DEP-ESC", "DEP-FSD"], "Data & AI": ["DEP-DS", "DEP-MKT"],
             "Security": ["DEP-SEC"], "Cloud & Platform": ["DEP-CLD"], "Software": ["DEP-APP"],
             "Commercial": ["DEP-ENT", "DEP-SME", "DEP-PRE"], "IoT & Edge": ["DEP-PRE", "DEP-ENT"],
             "Corporate": ["DEP-FIN", "DEP-RSK"], "Management": ["DEP-PRC"]}
SEV_HOURS = {"P1": 6, "P2": 18, "P3": 40, "P4": 72}


def add_case(w, org, pc, severity, opened, resolver, mttr, escalated, fcr, csat, summary):
    return w.add("customer_cases", id=w.next_id("CS"), org_id=org, problem_class_id=pc, severity=severity, opened=opened,
                 mttr_hours=round(mttr, 1), escalated=escalated, fcr=fcr, csat=csat, resolver_id=resolver, summary=summary)


def build_cases(w, n=270):
    customers = [o["id"] for o in w.rows("organisations") if o["kind"] == "customer"]
    pcs = w.rows("problem_classes")
    weights = [3 if pc["domain"] in ("Network", "BSS/OSS", "CX & Service") else 1 for pc in pcs]
    for _ in range(n):
        pc = w.rng.choices(pcs, weights)[0]
        deps = CASE_DEPS.get(pc["domain"], ["DEP-CC"])
        cands = [p for p in w.rows("people") if p["department_id"] in deps and p["id"] not in w.locked and p["level"] in ("AM", "SE", "E", "A")]
        resolver = w.rng.choice(cands)
        sev = w.rng.choices(["P1", "P2", "P3", "P4"], [5, 15, 40, 40])[0]
        fit = w.rng.uniform(.6, 1.4)
        mttr = SEV_HOURS[sev] * fit
        add_case(w, w.rng.choice(customers), pc["id"], sev, w.rand_date(), resolver["id"], mttr,
                 1 if fit > 1.2 else 0, 1 if fit < .8 else 0, 5 if fit < .8 else (4 if fit < 1.1 else 3),
                 f"{pc['name']} reported by customer")


def build_incidents(w, n=58):
    roles = {}
    for r in w.rows("system_roles"):
        roles.setdefault(r["system_id"], []).append(r["person_id"])
    systems = [s for s in w.rows("systems") if s["id"] not in ("SYS-RATE",)]
    for _ in range(n):
        s = w.rng.choice(systems)
        code = w.next_id("INC", 3)
        while code == "INC-042":  # reserved for the A14 walk-through
            code = w.next_id("INC", 3)
        inc = w.add("incidents", id=code, code=code, system_id=s["id"], severity=w.rng.choices(["P1", "P2", "P3"], [10, 35, 55])[0],
                    opened=w.rand_date(), duration_hours=round(w.rng.uniform(1, 30), 1), summary=f"{s['name']} degradation")
        pool = [p for p in roles.get(s["id"], []) if p not in w.locked] or [w.rng.choice(eligible_people(w, None))["id"]]
        for pid in w.rng.sample(pool, min(len(pool), w.rng.randint(1, 2))):
            w.add("incident_resolvers", incident_id=inc["id"], person_id=pid)


KI_KINDS = ["runbook", "solution note", "design doc", "code repo", "lessons learned"]


def build_knowledge(w, n=150):
    asg = [a for a in w.rows("assignments") if a["person_id"] not in w.locked]
    projects = w.by_id("projects")
    for _ in range(n):
        a = w.rng.choice(asg)
        p = projects[a["project_id"]]
        kind = w.rng.choice(KI_KINDS)
        kid = w.next_id("KI", 3)
        if kid == "KI-117":  # reserved for the A1 anchor
            kid = w.next_id("KI", 3)
        w.add("knowledge_items", id=kid, code="", title=f"{kind.capitalize()}: {a['role']} for {p['name']}", kind=kind,
              author_id=a["person_id"], project_id=p["id"], problem_class_id=p["problem_class_id"], system_id=None,
              reuse_count=w.rng.choice([0, 0, 1, 1, 2, 3, 4, 6]), created=w.rand_date(p["start_date"][:10] if p["start_date"] >= "2025-01-01" else "2025-01-01"),
              body=f"{kind.capitalize()} produced during {p['name']}: {a['contribution_note']}.")
    for k in w.rows("knowledge_items"):
        k["code"] = k["id"]


def build_spend(w):
    vendors = {"Data & AI": "ORG-DFA", "Cloud & Platform": "ORG-ACP", "Security": "ORG-SLA", "Network": "ORG-ONS", "default": "ORG-NBC"}
    projects = [p for p in w.rows("projects") if p["external_spend_amt"] > 0]
    fam = {sid: f for sid, _, f, _ in SKILLS}
    ps = {}
    for r in w.rows("project_skills"):
        ps.setdefault(r["project_id"], []).append(r["skill_id"])
    for p in projects[:21]:
        sid = w.rng.choice(ps[p["id"]])
        rate = FINANCE["consultant_day_rate_amt"].get(fam[sid], FINANCE["consultant_day_rate_amt"]["default"])
        days = max(10, p["external_spend_amt"] // rate)
        w.add("external_engagements", id=w.next_id("EXT", 3), vendor_org_id=vendors.get(fam[sid], vendors["default"]),
              project_id=p["id"], skill_id=sid, days=days, cost_amt=days * rate, start_date=p["start_date"],
              description=f"External specialists for {p['name']}")
    reqs = [("Data Scientist", "Machine Learning", "DIV-ADL"), ("Automation Test Engineer", "Test Automation", "DIV-NI"),
            ("Cloud Engineer", "Kubernetes", "DIV-ITD"), ("Security Analyst", "Security Operations", "DIV-ITD"),
            ("Business Analyst", "Customer Journey Analytics", "DIV-CR"), ("Network Engineer", "IP/MPLS Routing", "DIV-NI"),
            ("Pre-sales Architect", "Pre-sales Architecture", "DIV-EG"), ("Billing Analyst", "Billing Systems", "DIV-ITD"),
            ("Data Engineer", "Data Engineering", "DIV-ADL"), ("Field Engineer", "Fibre Splicing", "DIV-NI"),
            ("Contact Centre Lead", "Contact Centre Operations", "DIV-CSO")]
    for title, skill, div in reqs:
        w.add("requisitions", id=w.next_id("REQ", 3), title=title, skill_id=SKILL_BY_NAME[skill], division_id=div,
              est_cost_amt=w.rng.choice([28000, 32000, 38000, 45000]), status=w.rng.choice(["open", "open", "on hold"]),
              opened=w.rand_date("2026-03-01", "2026-09-30"))


def build_recognition(w, n=560):
    by_proj = {}
    for a in w.rows("assignments"):
        by_proj.setdefault(a["project_id"], []).append(a["person_id"])
    projects = [p for p, m in by_proj.items() if len(m) >= 2]
    made = 0
    while made < n:
        pid = w.rng.choice(projects)
        a, b = w.rng.sample(by_proj[pid], 2)
        if b in w.locked or a in w.locked:
            continue
        w.add("peer_recognition", id=w.next_id("REC"), from_id=a, to_id=b, question=w.rng.choice(RECOGNITION_QUESTIONS),
              project_id=pid, date=w.rand_date())
        made += 1
    people = [p for p in w.rows("people") if p["id"] not in w.locked]
    weights = [(9 - p["level_rank"]) * (2 if p["location_id"] == "LOC-SIN" else 1) for p in people]
    for _ in range(190):
        p = w.rng.choices(people, weights)[0]
        w.add("visibility_signals", id=w.next_id("VIS"), person_id=p["id"], kind=w.rng.choice(VISIBILITY_KINDS), date=w.rand_date())


def build_events(w):
    def ev(pid, kind, ref, date):
        if "2025-01-01" <= date <= "2026-09-30":
            w.add("events", id=w.next_id("EV", 5), person_id=pid, kind=kind, ref_id=ref, date=date)
    for a in w.rows("assignments"):
        ev(a["person_id"], "joined_project", a["project_id"], a["start_date"])
        if a["end_date"] < TODAY:
            ev(a["person_id"], "delivered_project", a["project_id"], a["end_date"])
    for c in w.rows("customer_cases"):
        ev(c["resolver_id"], "resolved_case", c["id"], c["opened"])
    inc = w.by_id("incidents")
    for r in w.rows("incident_resolvers"):
        ev(r["person_id"], "resolved_incident", r["incident_id"], inc[r["incident_id"]]["opened"])
    for k in w.rows("knowledge_items"):
        ev(k["author_id"], "published_knowledge", k["id"], k["created"])
    for c in w.rows("person_certs"):
        ev(c["person_id"], "certified", c["cert_id"], f"{c['year']}-06-15")
    for r in w.rows("peer_recognition"):
        ev(r["to_id"], "recognised", r["id"], r["date"])
    w.t["events"].sort(key=lambda e: (e["date"], e["id"]))


def build_profiles(w):
    sk = w.by_id("skills")
    deps = w.by_id("departments")
    for p in w.rows("people"):
        mine = sorted(w.skills_of(p["id"]).values(), key=lambda r: -r["level"])
        top = ", ".join(sk[r["skill_id"]]["name"] for r in mine[:4])
        dep = deps[p["department_id"]]["name"] if p["department_id"] else "the leadership team"
        w.add("profiles", person_id=p["id"],
              cv_summary=f"{p['title']} in {dep} since {p['hire_year']}. Strengths: {top}.",
              work_history=f"Joined {p['hire_year']}; current role {p['title']}.",
              interests=", ".join(sk[r["skill_id"]]["name"] for r in mine[4:6]) or "Continuous learning")


# ---------------------------------------------------------------- export
TABLE_ORDER = ["locations", "divisions", "departments", "teams", "people", "profiles", "skills", "skill_adjacency",
               "person_skills", "certifications", "person_certs", "trainings", "enrolments", "organisations",
               "problem_classes", "systems", "system_deps", "system_roles", "projects", "project_skills", "project_systems",
               "assignments", "customer_cases", "incidents", "incident_resolvers", "knowledge_items", "external_engagements",
               "requisitions", "opportunities", "opportunity_roles", "opportunity_role_skills", "peer_recognition",
               "visibility_signals", "sme_requests", "events", "impact_records", "reinvestment_initiatives"]


def export(w):
    SEED_DIR.mkdir(exist_ok=True)
    digest = hashlib.sha256()
    counts = {}
    for table in TABLE_ORDER:
        rows = w.rows(table)
        if not rows:
            raise SystemExit(f"table {table} is empty")
        cols = list(rows[0].keys())
        with open(SEED_DIR / f"{table}.csv", "w", newline="", encoding="utf-8") as f:
            wr = csv.DictWriter(f, fieldnames=cols)
            wr.writeheader()
            for r in rows:
                wr.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in cols})
        digest.update((SEED_DIR / f"{table}.csv").read_bytes())
        counts[table] = len(rows)
    (SEED_DIR / "story_manifest.json").write_text(json.dumps(w.manifest, indent=2), encoding="utf-8")
    (SEED_DIR / "finance_params.json").write_text(json.dumps(FINANCE, indent=2), encoding="utf-8")
    (SEED_DIR / "checksum.txt").write_text(digest.hexdigest() + "\n", encoding="utf-8")
    return counts, digest.hexdigest()


def main():
    w = World()
    build_org(w)
    build_people(w)
    build_skills(w)
    build_person_skills(w)
    build_reference(w)
    anchors.plant_people(w)        # converts chosen people into anchor characters, locks them
    build_learning(w)
    build_system_roles(w)
    anchors.plant_systems(w)
    build_projects(w)
    anchors.plant_projects(w)
    fill_unassigned(w)
    build_cases(w)
    build_incidents(w)
    anchors.plant_ops(w)
    build_knowledge(w)
    anchors.plant_knowledge(w)
    build_spend(w)
    anchors.plant_spend(w)
    build_recognition(w)
    anchors.plant_recognition(w)
    anchors.plant_demand(w)
    anchors.plant_value(w)
    build_events(w)
    build_profiles(w)
    anchors.finalise(w)
    counts, digest = export(w)
    for t in TABLE_ORDER:
        print(f"{t:26} {counts[t]:6}")
    print(f"checksum {digest[:16]}")


if __name__ == "__main__":
    main()
