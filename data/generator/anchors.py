"""Story anchors: hand-written records that prove each SkillBridge feature (A1..A18).

Anchor people are converted from generated people (keeps the level pyramid intact), then locked so the
background generators never add random records to them. Every anchor writes its expected outcome to the manifest.
"""
from config import EMAIL_DOMAIN, TODAY
from names import email_for
from taxonomy import SKILL_BY_NAME

A = {}  # anchor key -> person id


def pick(w, dep=None, level=None, loc=None, exclude=()):
    for p in w.rows("people"):
        if p["id"] in w.locked or p["id"] in exclude:
            continue
        if dep and p["department_id"] != dep:
            continue
        if level and p["level"] not in (level if isinstance(level, tuple) else (level,)):
            continue
        if loc and p["location_id"] != loc:
            continue
        return p
    raise LookupError(f"no person for dep={dep} level={level} loc={loc}")


def become(w, key, p, name=None, title=None, skills=None, hire=None, availability=None, lock=True, **extra):
    if name:
        w.emails.discard(p["email"])
        p["name"] = name
        p["email"] = email_for(name, w.emails, EMAIL_DOMAIN)
    if title:
        p["title"] = title
    if hire:
        p["hire_year"] = hire
    if availability is not None:
        p["availability_pct"] = availability
    p.update(extra)
    if skills is not None:
        w.t["person_skills"] = [r for r in w.rows("person_skills") if r["person_id"] != p["id"]]
        for s, (lvl, year) in skills.items():
            w.set_skill(p["id"], s, lvl, "declared", year)
    if lock:
        w.locked.add(p["id"])
    A[key] = p["id"]
    return p


# ------------------------------------------------------------------ people
def plant_people(w):
    become(w, "hafiz", pick(w, "DEP-LAB", "SE"), "Hafiz Rahman", "Senior Network Engineer", hire=2016, availability=30,
           location_id="LOC-BLR", consent_visibility=1,
           skills={"Network Test Engineering": (5, 2026), "OLT Configuration": (5, 2026), "GPON": (4, 2026),
                   "Fibre Testing (OTDR)": (4, 2025), "IP/MPLS Routing": (3, 2024), "SNMP Monitoring": (3, 2025)})
    become(w, "priya", pick(w, "DEP-BSS", "AM"), "Priya Nair", "Assistant Manager, Billing Operations", hire=2015,
           availability=10, location_id="LOC-SIN", consent_visibility=1,
           skills={"Billing Systems": (5, 2026), "Rating Engine": (4, 2026), "Revenue Assurance": (4, 2026),
                   "Mediation": (4, 2026), "SQL": (4, 2026), "PL/SQL": (4, 2026), "Order Management": (3, 2025)})
    become(w, "rate_senior", pick(w, "DEP-BSS", ("M", "SM")), title="Billing Platform Manager", hire=1994,
           retirement_risk=1, consent_visibility=1,
           skills={"Rating Engine": (5, 2026), "PL/SQL": (5, 2026), "COBOL": (4, 2024), "Billing Systems": (4, 2026),
                   "People Leadership": (4, 2026)})
    become(w, "rate_veteran", pick(w, "DEP-BSS", ("SE", "AM")), title="Senior Rating Specialist", hire=1998,
           retirement_risk=0, consent_visibility=1,
           skills={"Rating Engine": (5, 2026), "PL/SQL": (5, 2026), "COBOL": (3, 2023), "Mediation": (3, 2025)})
    become(w, "lim", pick(w, "DEP-MKT", ("SE",)), "Lim Wei Ling", "Senior Data Analyst", hire=2019, availability=25,
           consent_visibility=1,
           skills={"Python": (5, 2026), "SQL": (4, 2026), "Statistics": (4, 2026), "Machine Learning": (4, 2025),
                   "Data Visualization": (4, 2026), "Customer Journey Analytics": (3, 2025), "Docker": (4, 2025),
                   "CI/CD": (4, 2025)})
    become(w, "cloud_ready", pick(w, "DEP-CLD", ("SE", "E")), title="Senior Cloud Engineer", hire=2018, availability=45,
           consent_visibility=1,
           skills={"Kubernetes": (4, 2026), "Docker": (4, 2026), "CI/CD": (5, 2026), "Python": (4, 2025),
                   "Machine Learning": (3, 2025), "Linux Administration": (4, 2026), "Observability": (4, 2025)})
    become(w, "cloud_idle", pick(w, "DEP-CLD", ("AM", "SE")), title="Cloud Platform Lead", hire=2014, availability=55,
           skills={"Kubernetes": (5, 2026), "Terraform": (4, 2026), "AWS": (4, 2026), "Docker": (4, 2026), "CI/CD": (4, 2025)})
    kch = pick(w, "DEP-FOR", ("A", "E"), "LOC-DRW")
    become(w, "joseph", kch, "Joseph Mendoza", "Technician", hire=2022, availability=20, level="A", level_rank=8,
           loaded_rate_amt=45, consent_visibility=1,
           skills={"Fibre Splicing": (3, 2026), "Fibre Testing (OTDR)": (3, 2026), "Network Troubleshooting": (2, 2026),
                   "Field Service Coordination": (2, 2025), "LoRaWAN": (3, 2025), "Data Visualization": (2, 2026)})
    # A5 delivery team (with Hafiz as hidden talent)
    become(w, "ds", pick(w, "DEP-DS", "SE"), title="Senior Data Scientist", hire=2017, availability=50,
           skills={"Machine Learning": (5, 2026), "Statistics": (5, 2026), "Python": (5, 2026), "SQL": (4, 2026),
                   "Customer Journey Analytics": (4, 2025), "Retail Analytics": (3, 2025), "Deep Learning": (3, 2025)})
    become(w, "ai_eng", pick(w, "DEP-AIP", ("SE", "AM")), title="Senior AI Engineer", hire=2019, availability=35,
           skills={"LLM Applications": (5, 2026), "Machine Learning": (4, 2026), "REST API Design": (4, 2026),
                   "NLP": (4, 2026), "Python": (5, 2026), "Docker": (3, 2025)})
    become(w, "de", pick(w, "DEP-DE", ("AM", "SE")), title="Data Engineering Lead", hire=2016, availability=40,
           skills={"Data Engineering": (5, 2026), "ETL Pipelines": (5, 2026), "SQL": (5, 2026), "Spark": (4, 2026),
                   "Python": (4, 2026), "Data Warehousing": (4, 2025)})
    become(w, "cx", pick(w, "DEP-CC", ("SE", "AM")), title="Senior CX Analyst", hire=2018, availability=30,
           skills={"Customer Journey Analytics": (4, 2026), "CX Design": (5, 2026), "Customer Retention": (4, 2026),
                   "Contact Centre Operations": (4, 2025), "Data Visualization": (3, 2025)})
    become(w, "retail", pick(w, "DEP-ENT", "M"), title="Retail Sector Account Manager", hire=2012, availability=25,
           skills={"Retail Analytics": (5, 2026), "Enterprise Account Management": (5, 2026), "Solution Selling": (4, 2026),
                   "Stakeholder Management": (4, 2026), "Bid & Proposal Writing": (3, 2025)})
    # A6: credible holders for the security and product roles of the AI customer-service team
    become(w, "sec", pick(w, "DEP-SEC", ("SE", "AM")), title="Senior Security Analyst", hire=2015,
           skills={"Security Operations": (5, 2026), "Data Privacy (PDPA)": (5, 2026), "Security Compliance": (4, 2026),
                   "Threat Intelligence": (4, 2025), "Network Security": (4, 2025)})
    become(w, "pm", pick(w, "DEP-APP", ("M", "AM")), title="Digital Product Manager", hire=2013,
           skills={"Agile Delivery": (5, 2026), "Product Marketing": (4, 2026), "Stakeholder Management": (5, 2026),
                   "Project Management": (4, 2026), "TypeScript": (2, 2023)})
    # A12 duplicate churn model, ADL side
    become(w, "ds_churn", pick(w, "DEP-DS", ("SE", "E")), title="Data Scientist", hire=2020, availability=20,
           skills={"Machine Learning": (4, 2025), "Python": (4, 2026), "Statistics": (4, 2025), "SQL": (3, 2025)})
    # A11 capabilities that combine into a revenue offer (3 different teams), not locked
    for dep, skills in (("DEP-PRE", {"IoT Platforms": (5, 2026), "Smart Campus Solutions": (5, 2026)}),
                        ("DEP-AIP", {"Video Analytics": (5, 2026), "Computer Vision": (5, 2026)}),
                        ("DEP-CLD", {"Edge Computing": (5, 2026), "Kubernetes": (4, 2026)})):
        p = pick(w, dep, ("SE", "AM", "E"))
        for s, (lvl, yr) in skills.items():
            w.set_skill(p["id"], s, lvl, "declared", yr)
        A.setdefault("a11", []).append(p["id"])
    # A9: Lisbon data engineering team has spare capacity next quarter
    for p in w.rows("people"):
        if p["department_id"] == "DEP-DE" and p["location_id"] == "LOC-LIS" and p["id"] != A["de"]:
            p["availability_pct"] = 30 + (int(p["id"][2:]) % 3) * 5
    # A19 forgotten expert: deep core-network expertise, busy in 2025, nothing since (picked last so earlier picks are unchanged)
    become(w, "forgotten", pick(w, "DEP-CORE", "SE"), title="Senior Network Architect", hire=2001, availability=70, consent_visibility=1,
           skills={"IP/MPLS Routing": (5, 2025), "Network Design": (5, 2025), "BGP": (5, 2025), "Optical Transport (DWDM)": (4, 2024)})
    # A20 off-chart contributor: on no project roster, yet fixes other teams' systems and writes their runbooks
    become(w, "ghost", pick(w, "DEP-FSD", "E"), title="Field Service Coordinator", availability=15, consent_visibility=1,
           skills={"Field Service Coordination": (3, 2026), "Network Troubleshooting": (4, 2026), "SNMP Monitoring": (3, 2026),
                   "OLT Configuration": (3, 2025)})
    # A17: no anchor hero opts out
    for key in ("hafiz", "priya", "lim", "joseph"):
        w.person(A[key])["consent_visibility"] = 1


# ------------------------------------------------------------------ systems
def plant_systems(w):
    # A3: RatePro knowledge sits with three people only
    w.t["system_roles"] = [r for r in w.rows("system_roles") if r["system_id"] != "SYS-RATE"]
    w.add("system_roles", system_id="SYS-RATE", person_id=A["rate_senior"], role="owner")
    w.add("system_roles", system_id="SYS-RATE", person_id=A["rate_veteran"], role="maintainer")
    w.add("system_roles", system_id="SYS-RATE", person_id=A["priya"], role="maintainer")
    w.add("system_roles", system_id="SYS-BILL", person_id=A["priya"], role="sme")
    w.add("system_roles", system_id="SYS-MED", person_id=A["priya"], role="sme")
    w.add("system_roles", system_id="SYS-ALAB", person_id=A["hafiz"], role="maintainer")
    w.add("system_roles", system_id="SYS-NOVA", person_id=A["hafiz"], role="sme")
    # A14: Network Test Lab links straight to NOVA NMS for the walk-through
    w.add("system_deps", system_id="SYS-ALAB", depends_on_id="SYS-NOVA")
    A["nova_maint"] = next(r["person_id"] for r in w.rows("system_roles") if r["system_id"] == "SYS-NOVA" and r["role"] in ("owner", "maintainer"))


# ------------------------------------------------------------------ projects
def project(w, key, name, ptype, div, start, end, skills, systems, pc, budget, value, customer=None, ext=0, desc=""):
    from generate import pc_id, status_for
    leaders = [p for p in w.rows("people") if p["division_id"] == div and p["level"] in ("GM", "SM")]
    pms = [p for p in w.rows("people") if p["division_id"] == div and p["level"] in ("M", "AM")]
    pid = w.next_id("PRJ", 3)
    st = status_for(start, end)
    proj = w.add("projects", id=pid, code=pid.replace("PRJ", "P"), name=name, type=ptype, division_id=div,
                 sponsor_id=leaders[0]["id"], pm_id=pms[len(name) % len(pms)]["id"], status=st, start_date=start,
                 end_date=end, budget_amt=budget, external_spend_amt=ext,
                 outcome={"completed": "Delivered", "active": "In delivery", "planned": "Planned"}[st], value_amt=value,
                 customer_id=customer, problem_class_id=pc_id(w, pc), location_id=None, description=desc or f"{name}.")
    for s in skills:
        w.add("project_skills", project_id=pid, skill_id=SKILL_BY_NAME[s])
    for s in systems:
        w.add("project_systems", project_id=pid, system_id=s)
    A.setdefault("projects", {})[key] = pid
    return proj


def assign(w, proj, pid, role, alloc, man_days, note, start=None, end=None):
    return w.add("assignments", id=w.next_id("ASG"), project_id=proj["id"], person_id=pid, role=role, allocation_pct=alloc,
                 man_days=man_days, contribution_note=note, start_date=start or proj["start_date"], end_date=end or proj["end_date"])


def helpers(w, proj, dep, n, role, note):
    """Add n unlocked colleagues from a department as supporting members."""
    cands = [p for p in w.rows("people") if p["department_id"] == dep and p["id"] not in w.locked and p["level"] in ("AM", "SE", "E", "A", "M")]
    for p in cands[:n]:
        assign(w, proj, p["id"], role, 30, 40, f"{note} on {proj['name']}")
    return [p["id"] for p in cands[:n]]


def plant_projects(w):
    h = A["hafiz"]
    # A1 + A14: Hafiz's evidence trail
    p1 = project(w, "lab_auto", "Lab Test Automation 2025", "process automation", "DIV-NI", "2025-02-03", "2025-08-29",
                 ["Python", "Test Automation", "Network Test Engineering", "OLT Configuration"], ["SYS-ALAB", "SYS-OLTM"],
                 "Test cycle too slow", 180000, 420000, desc="Automate OLT acceptance testing in Network Test Lab.")
    assign(w, p1, h, "Network Test Engineer", 60, 110,
           "Built Python automation for OLT acceptance testing in Network Test Lab; cut the test cycle from 3 days to 4 hours")
    helpers(w, p1, "DEP-LAB", 3, "Network Test Engineering", "Executed acceptance test runs")
    pa = project(w, "nova_a", "NOVA NMS alarm correlation upgrade", "it upgrade", "DIV-NI", "2025-06-02", "2026-02-27",
                 ["Network Management Systems", "SNMP Monitoring", "Network Telemetry"], ["SYS-NOVA", "SYS-TELE"],
                 "Network alarm flood", 350000, 500000, desc="Project A: reduce NOVA NMS alarm noise.")
    assign(w, pa, h, "SNMP Monitoring", 30, 45, "Wrote Python scripts to deduplicate SNMP traps feeding NOVA NMS and streamed trap telemetry into the data lake")
    assign(w, pa, A["nova_maint"], "Network Management Systems", 50, 90, "Upgraded NOVA NMS correlation rules")
    helpers(w, pa, "DEP-OSS", 2, "Network Management Systems", "Tuned alarm correlation rules")
    pc = project(w, "nova_c", "OLT acceptance programme 2026", "process automation", "DIV-NI", "2026-01-05", "2026-12-18",
                 ["OLT Configuration", "Network Test Engineering", "Test Automation"], ["SYS-ALAB", "SYS-NOVA", "SYS-OLTM"],
                 "OLT acceptance testing", 260000, 380000, desc="Project C: national OLT acceptance using Network Test Lab.")
    assign(w, pc, h, "Network Test Engineering", 40, 70, "Extended the pytest acceptance framework to new OLT firmware releases")
    helpers(w, pc, "DEP-LAB", 2, "Network Test Engineering", "Ran regression packs")
    helpers(w, pc, "DEP-ACC", 2, "OLT Configuration", "Prepared OLT configurations")

    # A2: Priya contributes across exactly 6 projects, more of them recent
    pr = A["priya"]
    specs = [
        ("RatePro stabilisation 2025", "DIV-ITD", "2025-02-03", "2025-06-27", ["Rating Engine", "PL/SQL"], ["SYS-RATE"], "Rating engine error", "DEP-BSS"),
        ("Revenue assurance sweep 2025", "DIV-ITD", "2025-07-01", "2025-11-28", ["Revenue Assurance", "SQL"], ["SYS-RAT", "SYS-BILL"], "Revenue leakage", "DEP-FIN"),
        ("Enterprise billing migration", "DIV-EG", "2025-09-01", "2026-03-31", ["Billing Systems", "Order Management"], ["SYS-BILL", "SYS-ORD"], "Billing dispute", "DEP-ENT"),
        ("Mobile bundle launch billing", "DIV-CR", "2026-01-12", "2026-05-29", ["Billing Systems", "Pricing Strategy"], ["SYS-BILL", "SYS-APP"], "Billing dispute", "DEP-MOB"),
        ("Billing dispute reduction 2026", "DIV-CSO", "2026-03-02", "2026-09-25", ["Billing Systems", "Complaint Resolution"], ["SYS-BILL", "SYS-CCP"], "Repeat complaints", "DEP-CC"),
        ("Mediation re-platform 2026", "DIV-ITD", "2026-04-06", "2026-12-18", ["Mediation", "Rating Engine", "Kubernetes"], ["SYS-MED", "SYS-RATE", "SYS-K8S"], "Rating engine error", "DEP-CLD"),
    ]
    notes = ["Diagnosed and fixed recurring rating errors in RatePro", "Wrote leakage check queries that recovered missed charges",
             "Mapped enterprise tariffs into the new billing structure", "Configured bundle rating and validated first bill run",
             "Traced dispute root causes to rating rules and fixed them", "Documented RatePro rating logic for the re-platform team"]
    for i, (name, div, s, e, skills, systems, pc_, dep) in enumerate(specs):
        pj = project(w, f"priya{i}", name, "it upgrade", div, s, e, skills, systems, pc_, 200000 + i * 50000, 300000 + i * 60000)
        assign(w, pj, pr, skills[0], 30 + 5 * (i % 3), 35 + 8 * i, notes[i])
        helpers(w, pj, dep, 3, skills[-1], "Delivered workstream")
        if i == 0:
            assign(w, pj, A["rate_senior"], "Rating Engine", 40, 50, "Approved RatePro rule changes")
            assign(w, pj, A["rate_veteran"], "PL/SQL", 50, 60, "Rewrote PL/SQL rating procedures")

    # A12: two teams built the same churn model in 2025 (Lim in Marketing, ADL data science)
    cr = project(w, "churn_cr", "Retail campaign: churn save programme", "marketing", "DIV-CR", "2025-03-03", "2025-09-26",
                 ["Customer Retention", "Machine Learning", "Python"], ["SYS-C360"], "Customer churn", 220000, 310000)
    assign(w, cr, A["lim"], "Machine Learning", 60, 95, "Built a customer churn propensity model (gradient boosting) for the save campaign")
    helpers(w, cr, "DEP-MKT", 2, "Customer Retention", "Ran retention offers")
    adl = project(w, "churn_adl", "Analytics product: churn prediction", "data product", "DIV-ADL", "2025-04-14", "2025-10-31",
                  ["Machine Learning", "Python", "Data Engineering"], ["SYS-DLK", "SYS-ML"], "Customer churn", 380000, 290000,
                  ext=330000)
    assign(w, adl, A["ds_churn"], "Machine Learning", 70, 105, "Trained churn prediction model v1 (gradient boosting) on lake data")
    assign(w, adl, A["ds"], "Statistics", 20, 18, "Reviewed feature set (part-time)", "2025-04-14", "2025-10-31")
    helpers(w, adl, "DEP-DE", 2, "Data Engineering", "Built feature pipelines")

    # A4: Kubernetes migration bought externally while internal cloud engineers sat under 50%
    k8s = project(w, "k8s", "Cloud migration wave 2025.K", "it upgrade", "DIV-ITD", "2025-03-03", "2025-08-29",
                  ["Kubernetes", "Docker", "Terraform", "CI/CD"], ["SYS-K8S", "SYS-CICD"], "Cloud cost overrun", 600000, 700000, ext=450000)
    assign(w, k8s, A["cloud_idle"], "Kubernetes", 20, 22, "Reviewed vendor Kubernetes designs (part-time)")
    assign(w, k8s, A["cloud_ready"], "CI/CD", 20, 22, "Set up deployment pipelines for migrated services (part-time)")

    # A5 team: prior evidence for each member
    ev = [("ds", "Analytics product: next best offer", "DIV-ADL", "2024-06-03", "2025-02-28", ["Machine Learning", "Statistics", "Python"], ["SYS-ML", "SYS-C360"], "Customer segmentation", "Built next-best-offer propensity models for retail customers"),
          ("ai_eng", "GenAI agent assist pilot", "DIV-ADL", "2025-09-01", "2026-04-30", ["LLM Applications", "NLP", "REST API Design"], ["SYS-BOT", "SYS-ML"], "Contact centre deflection", "Built the LLM agent-assist API and retrieval layer"),
          ("de", "Customer 360 data platform", "DIV-ADL", "2025-01-06", "2025-12-19", ["Data Engineering", "ETL Pipelines", "SQL"], ["SYS-DLK", "SYS-C360"], "Customer segmentation", "Designed the customer 360 ETL pipelines on the lake"),
          ("cx", "Contact centre improvement 2026.CX", "DIV-CSO", "2025-11-03", "2026-06-26", ["CX Design", "Customer Journey Analytics", "Contact Centre Operations"], ["SYS-CCP", "SYS-C360"], "Repeat complaints", "Mapped repeat-complaint journeys and redesigned the flow"),
          ("retail", "Enterprise RFP delivery: Brightway Retail Group", "DIV-EG", "2025-05-05", "2025-12-12", ["Pre-sales Architecture", "Solution Selling", "Retail Analytics"], ["SYS-EPT"], "Retail footfall insight", "Led retail analytics requirements with the customer")]
    for key, name, div, s, e, skills, systems, pc_, note in ev:
        cust = "ORG-SRG" if "Sejahtera" in name else None
        pj = project(w, f"a5_{key}", name, "data product" if div == "DIV-ADL" else "customer delivery", div, s, e, skills, systems, pc_, 300000, 450000, customer=cust)
        assign(w, pj, A[key], skills[0], 50, 80, note)
    for key, name, skills, systems, pc_, note in (
            ("pm", "Digital channel release 2025.PM", ["Agile Delivery", "Product Marketing", "Stakeholder Management"], ["SYS-APP", "SYS-EPT"],
             "Repeat complaints", "Ran the agile release train and launch plan for the self-care app"),
            ("sec", "Security uplift 2025.PDPA", ["Security Operations", "Data Privacy (PDPA)", "Security Compliance"], ["SYS-SIEM", "SYS-IAM"],
             "Data privacy request", "Built the PDPA data-request process and SOC playbooks")):
        pj = project(w, f"a6_{key}", name, "compliance" if key == "sec" else "product", "DIV-ITD", "2025-03-03", "2025-11-28",
                     skills, systems, pc_, 250000, 320000)
        assign(w, pj, A[key], skills[0], 50, 80, note)
    # Joseph: regional fault restoration
    fr = project(w, "fault_swk", "Fault restoration programme Northern Territory", "operations", "DIV-NI", "2025-04-01", "2026-03-27",
                 ["Network Troubleshooting", "Fibre Testing (OTDR)", "Field Service Coordination"], ["SYS-FSA", "SYS-NOVA"],
                 "Fibre fault localisation", 160000, 240000)
    assign(w, fr, A["joseph"], "Fibre Testing (OTDR)", 60, 120, "Localised fibre faults with OTDR traces and a self-built Power BI fault map")
    helpers(w, fr, "DEP-FOR", 3, "Network Troubleshooting", "Restored faults")
    # A19: the architect's last big piece of work (2025)
    core = project(w, "core_2025", "MPLS core redesign 2025", "network rollout", "DIV-NI", "2025-01-06", "2025-07-25",
                   ["IP/MPLS Routing", "Network Design", "BGP"], ["SYS-MPLS", "SYS-DWDM"], "Core routing instability", 520000, 900000,
                   desc="Redesign of the MPLS core topology and route reflectors.")
    assign(w, core, A["forgotten"], "Network Design", 70, 110, "Designed the new MPLS core topology and the BGP route-reflector plan")
    helpers(w, core, "DEP-CORE", 2, "IP/MPLS Routing", "Migrated core links")
    # Lim and cloud_ready: light recent work
    rt = project(w, "lim_dash", "Retail campaign 2026.dash", "marketing", "DIV-CR", "2026-02-02", "2026-07-31",
                 ["Data Visualization", "Customer Journey Analytics"], ["SYS-C360"], "Customer churn", 90000, 120000)
    assign(w, rt, A["lim"], "Data Visualization", 40, 50, "Built churn and retention dashboards")
    assign(w, rt, A["cx"], "Customer Journey Analytics", 20, 15, "Advised on journey metrics")


# ------------------------------------------------------------------ cases and incidents
def plant_ops(w):
    from generate import add_case, pc_id
    bss_others = [p["id"] for p in w.rows("people") if p["department_id"] == "DEP-BSS" and p["id"] not in w.locked][:4]
    trio = [A["rate_senior"], A["rate_veteran"], A["priya"]]
    # A3: 16 RatePro incidents, 32 resolver credits, 25 held by the trio (78%)
    for i in range(16):
        inc_id = f"INC-R{i + 1:02d}"
        w.add("incidents", id=inc_id, code=inc_id, system_id="SYS-RATE", severity=["P1", "P2", "P2", "P3"][i % 4],
              opened=w.rand_date(), duration_hours=round(4 + (i * 1.7) % 14, 1), summary="RatePro rating run failure")
        first = trio[i % 3]
        second = trio[(i + 1) % 3] if i < 9 else bss_others[i % len(bss_others)]
        w.add("incident_resolvers", incident_id=inc_id, person_id=first)
        w.add("incident_resolvers", incident_id=inc_id, person_id=second)
    # A1 + A14: Incident 42 on NOVA NMS, fixed with Hafiz's script
    w.add("incidents", id="INC-042", code="INC-042", system_id="SYS-NOVA", severity="P2", opened="2025-07-14", duration_hours=6.5,
          summary="Alarm flood on NOVA NMS; resolved by a Python script that deduplicated SNMP traps")
    w.add("incident_resolvers", incident_id="INC-042", person_id=A["hafiz"])
    w.add("incident_resolvers", incident_id="INC-042", person_id=A["nova_maint"])
    w.add("incidents", id="INC-090", code="INC-090", system_id="SYS-OLTM", severity="P3", opened="2026-03-09", duration_hours=3.0,
          summary="OLT firmware regression caught by the automated acceptance test script in Network Test Lab")
    w.add("incident_resolvers", incident_id="INC-090", person_id=A["hafiz"])
    # A2: Priya resolves cross-team billing incidents, rising through 2026
    dates = ["2025-03-11", "2025-08-19", "2025-11-04", "2026-01-20", "2026-02-17", "2026-03-24", "2026-04-28",
             "2026-05-26", "2026-06-23", "2026-07-21", "2026-08-18", "2026-09-15"]
    systems = ["SYS-BILL", "SYS-MED", "SYS-RAT", "SYS-BILL", "SYS-PAY", "SYS-BILL", "SYS-MED", "SYS-ORD", "SYS-BILL", "SYS-RAT", "SYS-BILL", "SYS-MED"]
    for i, (d, s) in enumerate(zip(dates, systems)):
        inc_id = f"INC-B{i + 1:02d}"
        w.add("incidents", id=inc_id, code=inc_id, system_id=s, severity="P2" if i % 3 == 0 else "P3", opened=d,
              duration_hours=round(2 + i % 5, 1), summary="Billing chain issue escalated from another team")
        w.add("incident_resolvers", incident_id=inc_id, person_id=A["priya"])
    # A8: Joseph resolves fibre fault localisation cases far faster than peers
    fibre = pc_id(w, "Fibre fault localisation")
    for d, org, mttr in (("2025-06-10", "ORG-AGR", 9.5), ("2025-11-03", "ORG-JKS", 8.0), ("2026-04-21", "ORG-AIR", 7.5)):
        add_case(w, org, fibre, "P2", d, A["joseph"], mttr, 0, 1, 5, "Fibre fault localisation: cut found with OTDR trace on first visit")
    # A13: enterprise VPN latency, the right people fix it fast, others escalate
    vpn = pc_id(w, "Enterprise VPN latency")
    core = [p["id"] for p in w.rows("people") if p["department_id"] == "DEP-CORE" and p["id"] not in w.locked and p["level"] in ("SE", "AM")][:2]
    cc = [p["id"] for p in w.rows("people") if p["department_id"] == "DEP-CC" and p["id"] not in w.locked][:2]
    A["vpn_experts"] = core
    for pid in core:
        for s, lvl in (("IP/MPLS Routing", 5), ("BGP", 4), ("Network Troubleshooting", 4)):
            w.set_skill(pid, s, lvl, "declared", 2026)
    for d, org, res, mttr, esc in (("2025-04-08", "ORG-BDN", core[0], 7.0, 0), ("2025-08-26", "ORG-INS", core[1], 9.0, 0),
                                   ("2025-12-02", "ORG-PLM", cc[0], 52.0, 1), ("2026-05-12", "ORG-KMH", cc[1], 47.0, 1)):
        add_case(w, org, vpn, "P2", d, res, mttr, esc, 0 if esc else 1, 3 if esc else 5,
                 "Enterprise VPN latency: " + ("QoS policy fixed on the PE router" if not esc else "escalated twice before core team engaged"))
    # A19: core incidents fixed by the architect, all in 2025
    for i, (d, s) in enumerate((("2025-02-11", "SYS-MPLS"), ("2025-04-03", "SYS-DWDM"), ("2025-06-17", "SYS-MPLS"),
                                ("2025-09-09", "SYS-MPLS"), ("2025-11-20", "SYS-DWDM")), 1):
        w.add("incidents", id=f"INC-F{i:02d}", code=f"INC-F{i:02d}", system_id=s, severity="P1" if i == 1 else "P2", opened=d,
              duration_hours=3.0 + i, summary=("MPLS core" if s == "SYS-MPLS" else "DWDM transport") + " outage; root cause found by the network architect")
        w.add("incident_resolvers", incident_id=f"INC-F{i:02d}", person_id=A["forgotten"])
    # A20: the coordinator fixes other teams' systems without being on their projects or holding a system role
    for i, (d, s) in enumerate((("2025-05-14", "SYS-NOVA"), ("2025-08-21", "SYS-OLTM"), ("2025-12-03", "SYS-TELE"),
                                ("2026-02-10", "SYS-NOVA"), ("2026-05-19", "SYS-OLTM"), ("2026-08-04", "SYS-NOVA")), 1):
        w.add("incidents", id=f"INC-G{i:02d}", code=f"INC-G{i:02d}", system_id=s, severity="P2" if i % 2 else "P3", opened=d,
              duration_hours=2.0 + i % 3, summary="Field alarm escalated by the field service desk; fixed by remote NMS and OLT triage")
        w.add("incident_resolvers", incident_id=f"INC-G{i:02d}", person_id=A["ghost"])
    # A11: repeated demand for smart campus video analytics
    for d, org, pcn in (("2025-05-19", "ORG-UTK", "Smart campus security"), ("2025-09-08", "ORG-CAM", "Video analytics demand"),
                        ("2026-01-26", "ORG-STA", "Video analytics demand"), ("2026-04-13", "ORG-SCH", "Smart campus security"),
                        ("2026-07-06", "ORG-UNI", "Smart campus security")):
        add_case(w, org, pc_id(w, pcn), "P4", d, A["retail"], 24.0, 0, 1, 4,
                 f"{pcn}: customer asked for CCTV video analytics with on-site edge processing")


# ------------------------------------------------------------------ knowledge
def ki(w, code, title, kind, author, project_key, system, reuse, created, body, pc=None):
    from generate import pc_id
    proj = A["projects"].get(project_key) if project_key else None
    w.add("knowledge_items", id=code, code=code, title=title, kind=kind, author_id=author, project_id=proj,
          problem_class_id=pc_id(w, pc) if pc else None, system_id=system, reuse_count=reuse, created=created, body=body)


def plant_knowledge(w):
    ki(w, "KI-117", "pytest framework for OLT acceptance", "code repo", A["hafiz"], "lab_auto", "SYS-ALAB", 9, "2025-05-20",
       "Python and pytest framework that automates OLT acceptance test cases in Network Test Lab; reused by 3 teams.", "OLT acceptance testing")
    ki(w, "KI-P01", "RatePro rating error triage guide", "runbook", A["priya"], "priya0", "SYS-RATE", 11, "2025-05-06",
       "Step-by-step triage for RatePro rating failures, including PL/SQL fixes.", "Rating engine error")
    ki(w, "KI-P02", "Bill run recovery runbook", "runbook", A["priya"], "priya2", "SYS-BILL", 8, "2025-12-09",
       "How to recover a failed bill run without double charging.", "Billing dispute")
    ki(w, "KI-P03", "Revenue leakage check queries", "code repo", A["priya"], "priya1", "SYS-RAT", 6, "2025-10-14",
       "SQL checks that reconcile mediation, rating and billing totals.", "Revenue leakage")
    ki(w, "KI-P04", "Mediation backlog recovery", "runbook", A["priya"], "priya5", "SYS-MED", 7, "2026-06-02",
       "Recovering usage mediation backlogs after outages.", "Rating engine error")
    ki(w, "KI-P05", "RatePro rating logic explained", "design doc", A["priya"], "priya5", "SYS-RATE", 5, "2026-08-11",
       "Plain-language documentation of RatePro tariff rules for the re-platform.", "Legacy code risk")
    ki(w, "KI-C01", "Customer churn propensity model (gradient boosting)", "model", A["lim"], "churn_cr", "SYS-C360", 1, "2025-08-04",
       "Gradient boosting churn propensity model on 18 months of customer usage and complaints.", "Customer churn")
    ki(w, "KI-C02", "Churn prediction model v1 (gradient boosting)", "model", A["ds_churn"], "churn_adl", "SYS-ML", 1, "2025-09-22",
       "Gradient boosting churn prediction model trained on 18 months of lake data.", "Customer churn")
    ki(w, "KI-J01", "Fibre fault localisation checklist (Northern Territory)", "runbook", A["joseph"], "fault_swk", "SYS-FSA", 5, "2025-12-01",
       "OTDR-first checklist that finds fibre cuts on the first visit.", "Fibre fault localisation")
    ki(w, "KI-F01", "MPLS core design patterns", "design doc", A["forgotten"], "core_2025", "SYS-MPLS", 14, "2025-05-12",
       "Reference topology, route-reflector and QoS patterns for the MPLS core.", "Core routing instability")
    ki(w, "KI-F02", "BGP route-reflector migration guide", "runbook", A["forgotten"], "core_2025", "SYS-MPLS", 9, "2025-07-30",
       "Step-by-step migration to the new BGP route reflectors without traffic loss.", "Core routing instability")
    ki(w, "KI-G01", "NOVA alarm triage for field coordinators", "runbook", A["ghost"], "nova_a", "SYS-NOVA", 8, "2025-09-15",
       "Which NOVA NMS alarms need a field visit and which can be fixed remotely.", "Network alarm flood")
    ki(w, "KI-G02", "OLT swap field procedure", "runbook", A["ghost"], "nova_c", "SYS-OLTM", 6, "2026-03-02",
       "Swapping a failed OLT card and restoring its configuration from the fleet manager.", "OLT acceptance testing")


# ------------------------------------------------------------------ spend
def plant_spend(w):
    # anchor engagements replace the generic one the background pass created for the same project
    planted = {A["projects"]["k8s"], A["projects"]["churn_adl"]}
    w.t["external_engagements"] = [e for e in w.rows("external_engagements") if e["project_id"] not in planted]
    w.add("external_engagements", id="EXT-A01", vendor_org_id="ORG-ACP", project_id=A["projects"]["k8s"],
          skill_id=SKILL_BY_NAME["Kubernetes"], days=90, cost_amt=450000, start_date="2025-03-03",
          description="Kubernetes migration specialists for Cloud migration wave 2025.K")
    w.add("external_engagements", id="EXT-A02", vendor_org_id="ORG-DFA", project_id=A["projects"]["churn_adl"],
          skill_id=SKILL_BY_NAME["Machine Learning"], days=60, cost_amt=330000, start_date="2025-04-14",
          description="Churn modelling consultants for the churn prediction product")
    for title, skill, div in (("MLOps Engineer", "MLOps", "DIV-ADL"), ("Conversational AI Specialist", "Conversational AI Ops", "DIV-ADL")):
        w.add("requisitions", id=w.next_id("REQ", 3), title=title, skill_id=SKILL_BY_NAME[skill], division_id=div,
              est_cost_amt=45000, status="open", opened="2026-08-03")


# ------------------------------------------------------------------ recognition and visibility
def plant_recognition(w):
    from taxonomy import RECOGNITION_QUESTIONS as Q
    proj_members = {}
    for a in w.rows("assignments"):
        proj_members.setdefault(a["project_id"], []).append(a["person_id"])
    priya_projects = [A["projects"][f"priya{i}"] for i in range(6)]
    dates = sorted(w.rand_date("2025-02-01", "2025-12-31") for _ in range(8)) + sorted(w.rand_date("2026-01-01", "2026-09-30") for _ in range(19))
    for i, d in enumerate(dates):
        proj = priya_projects[min(5, i * 6 // len(dates))]
        others = [p for p in proj_members[proj] if p != A["priya"]]
        w.add("peer_recognition", id=w.next_id("REC"), from_id=others[i % len(others)], to_id=A["priya"],
              question=Q[(i * 2 + 2) % len(Q)], project_id=proj, date=d)
    for key, proj_key, n in (("hafiz", "lab_auto", 6), ("joseph", "fault_swk", 4), ("lim", "churn_cr", 3)):
        others = [p for p in proj_members[A["projects"][proj_key]] if p != A[key]]
        for i in range(n):
            w.add("peer_recognition", id=w.next_id("REC"), from_id=others[i % len(others)], to_id=A[key],
                  question=Q[i % len(Q)], project_id=A["projects"][proj_key], date=w.rand_date())
    w.add("visibility_signals", id=w.next_id("VIS"), person_id=A["hafiz"], kind="Internal newsletter feature", date="2025-09-10")
    w.add("visibility_signals", id=w.next_id("VIS"), person_id=A["rate_senior"], kind="Management review presenter", date="2026-02-12")
    # A17: one strong contributor opted out; Hidden Talent must not show them
    opted = [p for p in w.rows("people") if p["consent_visibility"] == 0 and p["id"] not in w.locked
             and any(a["person_id"] == p["id"] for a in w.rows("assignments"))]
    A["opted_out_star"] = opted[0]["id"]
    for i in range(20):
        w.add("peer_recognition", id=w.next_id("REC"), from_id=A["priya"] if i == 0 else w.rows("people")[10 + i]["id"],
              to_id=opted[0]["id"], question=Q[i % len(Q)], project_id=None, date=w.rand_date("2026-01-01", "2026-09-30"))
    # A19: thanked in 2025, nothing since
    core_m = [p for p in proj_members[A["projects"]["core_2025"]] if p != A["forgotten"]]
    for i, d in enumerate(("2025-03-20", "2025-05-28", "2025-07-30", "2025-10-14")):
        w.add("peer_recognition", id=w.next_id("REC"), from_id=core_m[i % len(core_m)], to_id=A["forgotten"], question=Q[i % len(Q)],
              project_id=A["projects"]["core_2025"], date=d)
    # A20: thanked by teams whose rosters the coordinator is not on
    for i, (pk, d) in enumerate((("nova_a", "2025-09-02"), ("nova_c", "2026-02-24"), ("fault_swk", "2026-03-30"),
                                 ("nova_a", "2026-05-27"), ("nova_c", "2026-07-08"), ("fault_swk", "2026-08-19"))):
        ms = [p for p in proj_members[A["projects"][pk]] if p != A["ghost"]]
        w.add("peer_recognition", id=w.next_id("REC"), from_id=ms[i % len(ms)], to_id=A["ghost"], question=Q[(i + 3) % len(Q)],
              project_id=A["projects"][pk], date=d)


# ------------------------------------------------------------------ demand
OPPORTUNITIES = [
    # code, title, kind, org, deadline, ext quote, internal cost, revenue, hours saved, win prob, demo query, roles
    ("OPP-001", "AI-powered customer analytics", "customer project", "ORG-SRG", "2027-01-29", 220000, 100000, 300000, 450, 0.5,
     "We need to deliver an AI-powered customer analytics project.",
     [("Data Scientist", ["Machine Learning", "Statistics", "Python"], ["Customer Journey Analytics", "Retail Analytics"]),
      ("AI Engineer", ["LLM Applications", "Machine Learning", "REST API Design"], ["NLP"]),
      ("Data Engineer", ["Data Engineering", "ETL Pipelines", "SQL"], ["Spark"]),
      ("CX Analytics Specialist", ["Customer Journey Analytics", "CX Design"], ["Customer Retention"]),
      ("Retail Domain Lead", ["Retail Analytics", "Enterprise Account Management"], ["Solution Selling"]),
      ("Network Data Automation", ["Python", "Test Automation", "Network Telemetry"], ["Network Test Engineering"]),
      ("MLOps Engineer", ["MLOps", "Model Monitoring"], ["Python", "Machine Learning", "Docker", "CI/CD"])]),
    ("OPP-002", "Deploy AI customer-service solution", "internal project", None, "2027-03-31", 380000, 160000, 0, 380, 0.7,
     "Build a team to deploy an AI customer-service solution.",
     [("AI Specialist", ["LLM Applications", "NLP", "Python"], []), ("Data Engineer", ["Data Engineering", "ETL Pipelines", "SQL"], []),
      ("CX Specialist", ["Contact Centre Operations", "CX Design"], []), ("Cybersecurity Specialist", ["Security Operations", "Data Privacy (PDPA)"], []),
      ("Product Manager", ["Agile Delivery", "Product Marketing", "Stakeholder Management"], []),
      ("Conversational AI Ops", ["Conversational AI Ops", "LLM Applications"], [])]),
    ("OPP-003", "Automate OLT acceptance testing across regions", "internal project", None, "2026-12-18", 160000, 60000, 0, 220, 0.8,
     "Find someone who can help me automate this network testing process.",
     [("Test Automation Engineer", ["Python", "Test Automation", "Network Test Engineering"], ["OLT Configuration", "GPON"])]),
    ("OPP-004", "Smart campus video analytics offer", "customer project", "ORG-UTK", "2027-02-26", 300000, 140000, 900000, 300, 0.4,
     "Can we offer smart campus video analytics without hiring?",
     [("IoT Architect", ["IoT Platforms", "Smart Campus Solutions"], []), ("Video Analytics Engineer", ["Video Analytics", "Computer Vision"], []),
      ("Edge Platform Engineer", ["Edge Computing", "Kubernetes"], [])]),
    ("OPP-005", "AI-driven network optimisation solution", "customer project", "ORG-PLM", "2027-04-30", 450000, 210000, 750000, 400, 0.35,
     "We need an AI-driven network optimisation solution.",
     [("Network Engineer", ["IP/MPLS Routing", "Network Design"], []), ("Data Scientist", ["Machine Learning", "Statistics"], []),
      ("AI Engineer", ["Machine Learning", "Python"], []), ("Cybersecurity Specialist", ["Network Security", "Security Operations"], [])]),
    ("OPP-006", "Network telemetry data platform", "internal project", None, "2027-01-15", 250000, 110000, 0, 260, 0.75,
     "Who has spare capacity to build a network telemetry data platform?",
     [("Data Engineer", ["Data Engineering", "Spark", "ETL Pipelines"], ["Network Telemetry"]), ("Platform Engineer", ["Kubernetes", "Observability"], [])]),
    ("OPP-007", "Resolve enterprise VPN latency for Harbourline Bank", "customer issue", "ORG-BDN", "2026-10-17", 0, 0, 0, 40, 0.9,
     "Who has experience with this type of customer problem: enterprise VPN latency?",
     [("Core Network Specialist", ["IP/MPLS Routing", "BGP", "Network Troubleshooting"], [])]),
    ("OPP-008", "SME digital onboarding programme", "customer project", "ORG-SM1", "2027-02-12", 90000, 40000, 120000, 120, 0.5,
     "Find experts outside my department to support SME digital onboarding in Northern Territory.",
     [("SME Advisor", ["SME Sales", "Digital Marketing"], []), ("IoT Field Specialist", ["LoRaWAN", "Sensor Networks"], [])]),
    # no demo query: "Where are we over-dependent on individuals?" is answered by Executive Intelligence
    ("OPP-009", "Billing platform modernisation", "strategic initiative", None, "2027-06-30", 1200000, 600000, 0, 500, 0.6, None,
     [("Rating Specialist", ["Rating Engine", "PL/SQL"], []), ("Billing Architect", ["Billing Systems", "Microservices"], [])]),
    ("OPP-010", "Cyber SOC uplift", "internal project", None, "2027-03-31", 520000, 260000, 0, 300, 0.6, None,
     [("Security Analyst", ["Security Operations", "Threat Intelligence"], []), ("Cloud Security Engineer", ["Cloud Security", "Kubernetes"], [])]),
    ("OPP-011", "GenAI knowledge assistant", "internal project", None, "2027-02-26", 260000, 120000, 0, 600, 0.65, None,
     [("AI Engineer", ["LLM Applications", "NLP"], []), ("Data Engineer", ["Data Engineering", "SQL"], [])]),
    ("OPP-012", "Campus CCTV analytics tender", "customer project", "ORG-CAM", "2026-12-11", 180000, 90000, 420000, 160, 0.3, None,
     [("Video Analytics Engineer", ["Video Analytics", "Computer Vision"], []), ("Pre-sales Architect", ["Pre-sales Architecture", "Smart Campus Solutions"], [])]),
    ("OPP-013", "Fibre fault prediction", "internal project", None, "2027-03-31", 200000, 90000, 0, 350, 0.55, None,
     [("Field Expert", ["Fibre Testing (OTDR)", "Network Troubleshooting"], []), ("Data Scientist", ["Machine Learning", "Statistics"], [])]),
    ("OPP-014", "ESG reporting automation", "internal project", None, "2027-05-28", 140000, 70000, 0, 200, 0.5, None,
     [("ESG Analyst", ["ESG Reporting", "Data Visualization"], []), ("Data Engineer", ["Data Engineering", "SQL"], [])]),
    ("OPP-015", "5G fixed wireless launch", "customer project", None, "2027-04-16", 350000, 180000, 600000, 250, 0.45, None,
     [("RAN Engineer", ["5G RAN", "Network Design"], []), ("Product Specialist", ["Telco Products", "Pricing Strategy"], [])]),
]


OPP_PROBLEM = {"OPP-001": "Customer segmentation", "OPP-002": "Contact centre deflection", "OPP-003": "OLT acceptance testing",
               "OPP-004": "Video analytics demand", "OPP-005": "Network optimisation", "OPP-006": "Network capacity planning",
               "OPP-007": "Enterprise VPN latency", "OPP-008": "SME digital onboarding", "OPP-009": "Rating engine error",
               "OPP-012": "Video analytics demand", "OPP-013": "Fibre fault localisation"}


def plant_demand(w):
    from generate import pc_id
    for code, title, kind, org, deadline, quote, cost, rev, hours, win, query, roles in OPPORTUNITIES:
        w.add("opportunities", id=code, code=code, title=title, kind=kind, org_id=org, description=title + ".", deadline=deadline,
              external_quote_amt=quote, internal_cost_amt=cost, revenue_potential_amt=rev, hours_saved=hours, win_probability=win,
              status="open", demo_query=query, problem_class_id=pc_id(w, OPP_PROBLEM[code]) if code in OPP_PROBLEM else None)
        for i, (role, must, nice) in enumerate(roles, 1):
            rid = f"{code}-R{i}"
            w.add("opportunity_roles", id=rid, opportunity_id=code, role=role, headcount=1)
            for s in must:
                w.add("opportunity_role_skills", role_id=rid, skill_id=SKILL_BY_NAME[s], must=1)
            for s in nice:
                w.add("opportunity_role_skills", role_id=rid, skill_id=SKILL_BY_NAME[s], must=0)
    for i, (org, skill, desc, d) in enumerate((
            ("ORG-SM1", "Retail Analytics", "Help reading sales data from three shops", "2026-05-11"),
            ("ORG-SM2", "LoRaWAN", "Soil sensor network for a smallholder estate", "2026-06-08"),
            ("ORG-SM3", "Digital Marketing", "Launch an online store campaign", "2026-07-02"),
            ("ORG-SM4", "Data Visualization", "Delivery performance dashboard", "2026-08-17"),
            ("ORG-SM5", "Data Privacy (PDPA)", "Patient data privacy check", "2026-09-07")), 1):
        w.add("sme_requests", id=f"SME-{i:02d}", org_id=org, skill_id=SKILL_BY_NAME[skill], description=desc, date=d)


# ------------------------------------------------------------------ value
def plant_value(w):
    rows = [
        # date, title, people, cost avoided, productivity, recruitment, revenue, customer impact, strategic value
        ("2025-02-14", "Internal network test automation instead of vendor scripts", 3, 90000, 14000, 0, 0, "Faster OLT turn-up", "Automation capability"),
        ("2025-03-21", "Internal BI team for retail dashboards", 2, 0, 14000, 0, 0, "Faster campaign insight", "Data literacy"),
        ("2025-04-25", "Security review staffed internally", 2, 60000, 14000, 0, 0, "None", "Security capability"),
        ("2025-05-30", "Billing fix team formed in hours", 4, 0, 14000, 0, 0, "Fewer billing disputes", "Billing resilience"),
        ("2025-06-27", "Cloud engineers redeployed to platform work", 3, 70000, 14000, 0, 0, "None", "Cloud capability"),
        ("2025-07-25", "Data engineer hire deferred", 1, 0, 14000, 30000, 0, "None", "Internal mobility"),
        ("2025-08-29", "Enterprise SD-WAN deal staffed from inside", 5, 0, 14000, 0, 180000, "Faster onboarding", "Enterprise growth"),
        ("2025-09-26", "Contact centre analytics without consultants", 3, 50000, 14000, 0, 0, "Shorter queues", "CX capability"),
        ("2025-10-31", "Two tester roles filled internally", 2, 0, 14000, 30000, 0, "None", "Internal mobility"),
        ("2025-11-28", "Fibre fault expert found in Northern Territory", 1, 0, 14000, 0, 0, "Faster restoration", "Regional talent"),
        ("2025-12-19", "Government portal bid team assembled", 4, 0, 14000, 0, 160000, "None", "Public sector growth"),
        ("2026-01-30", "Analyst hire avoided via reskilling", 1, 0, 14000, 30000, 0, "None", "Reskilling"),
        ("2026-02-27", "Internal pentest replaces vendor", 2, 60000, 14000, 0, 0, "None", "Security capability"),
        ("2026-03-27", "Knowledge reuse: runbooks shared across regions", 6, 0, 14000, 0, 0, "Faster restoration", "Knowledge reuse"),
        ("2026-04-24", "Retail analytics upsell from internal experts", 3, 0, 14000, 0, 160000, "Higher retention", "Revenue growth"),
        ("2026-05-29", "Cloud cost review done internally", 2, 50000, 14000, 0, 0, "None", "Cloud capability"),
        ("2026-06-26", "Two data roles filled by internal mobility", 2, 0, 14000, 30000, 0, "None", "Internal mobility"),
        ("2026-07-31", "Hospital network upgrade won with internal team", 4, 0, 14000, 0, 150000, "Faster resolution", "Healthcare growth"),
        ("2026-08-28", "Automation engineer hire avoided", 1, 0, 14000, 30000, 0, "None", "Automation capability"),
        ("2026-09-25", "Vendor data cleansing replaced internally", 2, 40000, 14000, 0, 0, "None", "Data capability"),
    ]
    for i, (d, title, n, cost, prod, rec, rev, cx, strat) in enumerate(rows, 1):
        w.add("impact_records", id=f"IMP-{i:03d}", date=d, title=title, opportunity_id=None, people_count=n, cost_avoided_amt=cost,
              productivity_amt=prod, recruitment_amt=rec, revenue_amt=rev, customer_impact=cx, strategic_value=strat, source="seed", person_ids="")
    for iid, name, amt, outcome in (("INI-1", "AI capability development", 300000, "Build future AI workforce"),
                                    ("INI-2", "Employee reskilling", 250000, "Close critical skill gaps"),
                                    ("INI-3", "Digital inclusion", 200000, "Extend capability access"),
                                    ("INI-4", "Innovation projects", 400000, "Develop new products"),
                                    ("INI-5", "Customer experience", 250000, "Improve service resolution"),
                                    ("INI-6", "Sustainability programmes", 100000, "Social and environmental initiatives")):
        w.add("reinvestment_initiatives", id=iid, name=name, allocation_amt=amt, outcome=outcome)


# ------------------------------------------------------------------ manifest
def finalise(w):
    nm = {p["id"]: p["name"] for p in w.rows("people")}
    e = w.expect
    e("A1", "Hidden capability (PRD 8.2)", "Hafiz has Python/automation evidence but no declared Python skill",
      {"person_id": A["hafiz"], "name": nm[A["hafiz"]], "no_declared_skills": ["Python", "Test Automation"],
       "evidence_min": 3, "opportunity": "OPP-003", "score_target": 87, "score_tolerance": 2})
    e("A2", "Hidden Talent mode (PRD 11.7)", "Priya: 6 projects, high recognition, near-zero visibility, rising trend",
      {"person_id": A["priya"], "name": nm[A["priya"]], "projects": 6, "recognition_min": 25, "visibility_max": 0,
       "critical_knowledge_areas": 4, "consent": 1})
    e("A3", "Concentration risk (PRD 8.6)", "Three people hold 78% of RatePro incident work",
      {"system_id": "SYS-RATE", "people": [A["rate_senior"], A["rate_veteran"], A["priya"]], "share": 0.78, "tolerance": 0.01,
       "hired_before_2000": 2, "retirement_risk": 1})
    e("A4", "Paying externals for internal skills", "Vendors engaged while internal holders were under 50% allocated",
      {"engagements": ["EXT-A01", "EXT-A02"], "internal_people": [A["cloud_idle"], A["cloud_ready"], A["ds"]], "max_allocation": 50})
    e("A5", "MVP demo (PRD 15)", "Customer analytics team: 6 internal people incl. Hafiz, 1 gap, 2 reskill candidates",
      {"opportunity": "OPP-001", "team": [A["ds"], A["ai_eng"], A["de"], A["cx"], A["retail"], A["hafiz"]], "hidden": [A["hafiz"]],
       "gap_skills": ["MLOps", "Model Monitoring"], "reskill": [A["lim"], A["cloud_ready"]],
       "cost_avoided_amt": 120000, "productivity_amt": 45000, "revenue_potential_amt": 300000})
    e("A6", "Team formation coverage (PRD 8.4)", "AI customer-service: about 82% internal coverage, 1 gap role",
      {"opportunity": "OPP-002", "coverage": 0.82, "tolerance": 0.04, "gap_skill": "Conversational AI Ops"})
    e("A7", "Reskilling (PRD 8.5)", "Lim ~75% ready for MLOps; 2 short courses + 1 assignment vs 6-month certificate",
      {"person_id": A["lim"], "readiness": 0.75, "tolerance": 0.06, "path": ["TRN-MLOPS1", "TRN-MON1", "TRN-MLOPSA"], "contrast": "TRN-MLCERT"})
    e("A8", "Hidden expert alert", "Joseph solved 3 fibre fault cases much faster than peers",
      {"person_id": A["joseph"], "problem": "Fibre fault localisation", "cases": 3, "location": "LOC-DRW"})
    e("A9", "Under-utilised capacity", "Lisbon data engineering has ~30% spare capacity for OPP-006",
      {"department": "DEP-DE", "location": "LOC-LIS", "availability_min": 30, "opportunity": "OPP-006"})
    e("A10", "Collaboration gap", "Enterprise Solutions and AI & Data Lab never share a project",
      {"department": "DEP-ENT", "division": "DIV-ADL", "shared_projects": 0})
    e("A11", "Revenue signal (PRD 6.2)", "Smart campus video analytics asked 7 times; 3 teams hold the pieces",
      {"opportunity": "OPP-004", "demand_signals_min": 7, "holders": A["a11"]})
    e("A12", "Duplicated work", "Two churn models built independently in 2025",
      {"knowledge": ["KI-C01", "KI-C02"], "projects": [A["projects"]["churn_cr"], A["projects"]["churn_adl"]]})
    e("A13", "Customer resolution (PRD 6.3)", "VPN latency: experts fix in <10h, others escalate at ~50h",
      {"opportunity": "OPP-007", "experts": A["vpn_experts"], "expert_mttr_max": 10, "other_mttr_min": 40})
    e("A14", "Dive into a system (PRD 11.6)", "NOVA NMS links Project A, Project C, INC-042, Network Test Lab, vendor, maintainer",
      {"system_id": "SYS-NOVA", "projects": [A["projects"]["nova_a"], A["projects"]["nova_c"]], "incident": "INC-042",
       "linked_system": "SYS-ALAB", "vendor": "ORG-TVN", "maintainer": A["nova_maint"]})
    e("A15", "Value loop (PRD 7, 10)", "20 impact records sum to $1.50M",
      {"records": 20, "cost_avoided_amt": 420000, "productivity_amt": 280000, "recruitment_amt": 150000, "revenue_amt": 650000, "total_amt": 1500000})
    e("A16", "Executive questions (PRD 4)", "Emerging skills in demand but thinly held",
      {"emerging": ["MLOps", "Model Monitoring", "Conversational AI Ops", "LLM Applications", "Edge Computing"]})
    e("A17", "Privacy (PRD 12)", "About 5% opted out; one strong contributor among them",
      {"opted_out_min": 13, "opted_out_max": 17, "opted_out_star": A["opted_out_star"]})
    e("A18", "SME / social (PRD 5)", "5 SME partner requests, incl. a LoRaWAN need matched in Northern Territory",
      {"requests": 5, "regional_match": A["joseph"]})
    e("A19", "Forgotten expert (People Signals)", "Network architect with heavily reused designs, active in 2025, nothing in 2026",
      {"person_id": A["forgotten"], "name": nm[A["forgotten"]], "knowledge": ["KI-F01", "KI-F02"], "reuse_min": 20, "events_2026": 0})
    e("A20", "Off-chart contributor (People Signals)", "Coordinator on no project roster who fixes other teams' systems",
      {"person_id": A["ghost"], "name": nm[A["ghost"]], "assignments": 0, "incidents_min": 6, "knowledge": ["KI-G01", "KI-G02"],
       "recognition_min": 6})
    for row in w.rows("people"):
        assert row["name"], row
