"""Generator constants: seed, org shape, level pyramid, money assumptions. All values are synthetic."""

SEED = 2026
COMPANY = "Veridane Networks"
EMAIL_DOMAIN = "veridane.example"  # reserved test domain, never a real mailbox
TODAY = "2026-10-10"

LOCATIONS = [
    ("LOC-SIN", "Singapore HQ", "Singapore", 0),
    ("LOC-BLR", "Bengaluru", "Singapore", 0),
    ("LOC-LIS", "Lisbon", "Northern", 0),
    ("LOC-SYD", "Sydney", "Southern", 0),
    ("LOC-MNL", "Manila", "East Coast", 0),
    ("LOC-DRW", "Darwin", "Northern Territory", 1),
    ("LOC-CNS", "Cairns", "Far North Queensland", 1),
]

# (division id, code, name, headcount, departments[(dept id, name, location weights)])
DIVISIONS = [
    ("DIV-NI", "NI", "Network & Infrastructure", 70, [
        ("DEP-ACC", "Access Network", {"LOC-SIN": 3, "LOC-LIS": 2, "LOC-SYD": 2}),
        ("DEP-CORE", "Core & Transport", {"LOC-BLR": 3, "LOC-SIN": 2}),
        ("DEP-LAB", "Network Testing Lab", {"LOC-BLR": 1}),
        ("DEP-FOC", "Field Ops Central", {"LOC-SIN": 2, "LOC-SYD": 1, "LOC-MNL": 1}),
        ("DEP-FOR", "Field Ops Regional", {"LOC-DRW": 2, "LOC-CNS": 2, "LOC-MNL": 1}),
    ]),
    ("DIV-EG", "EG", "Enterprise & Government", 50, [
        ("DEP-ENT", "Enterprise Solutions", {"LOC-SIN": 3, "LOC-LIS": 1}),
        ("DEP-GOV", "Government Accounts", {"LOC-SIN": 2, "LOC-DRW": 1}),
        ("DEP-SME", "SME Business", {"LOC-SIN": 1, "LOC-SYD": 1, "LOC-CNS": 1}),
        ("DEP-PRE", "Pre-sales", {"LOC-SIN": 1}),
    ]),
    ("DIV-CR", "CR", "Consumer & Retail", 40, [
        ("DEP-BB", "Broadband", {"LOC-SIN": 1}),
        ("DEP-MOB", "Mobile", {"LOC-SIN": 1}),
        ("DEP-RET", "Retail Channels", {"LOC-SIN": 1, "LOC-SYD": 1, "LOC-LIS": 1}),
        ("DEP-MKT", "Marketing", {"LOC-SIN": 1}),
    ]),
    ("DIV-CSO", "CSO", "Customer Service Ops", 40, [
        ("DEP-CC", "Contact Centre", {"LOC-MNL": 2, "LOC-SYD": 1, "LOC-SIN": 1}),
        ("DEP-ESC", "Escalations", {"LOC-SIN": 1}),
        ("DEP-FSD", "Field Service Desk", {"LOC-MNL": 1, "LOC-DRW": 1}),
    ]),
    ("DIV-ITD", "ITD", "IT & Digital", 50, [
        ("DEP-BSS", "BSS/Billing", {"LOC-SIN": 1}),
        ("DEP-OSS", "OSS", {"LOC-BLR": 1}),
        ("DEP-CLD", "Cloud Platform", {"LOC-BLR": 2, "LOC-LIS": 1}),
        ("DEP-SEC", "Cybersecurity", {"LOC-BLR": 1}),
        ("DEP-APP", "App Dev", {"LOC-SIN": 1, "LOC-LIS": 1}),
    ]),
    ("DIV-ADL", "ADL", "AI & Data Lab", 20, [
        ("DEP-DE", "Data Engineering", {"LOC-LIS": 1}),
        ("DEP-DS", "Data Science", {"LOC-SIN": 1}),
        ("DEP-AIP", "AI Products", {"LOC-SIN": 1}),
    ]),
    ("DIV-CF", "CF", "Corporate Functions", 30, [
        ("DEP-FIN", "Finance", {"LOC-SIN": 1}),
        ("DEP-HR", "HR", {"LOC-SIN": 1}),
        ("DEP-STR", "Strategy", {"LOC-SIN": 1}),
        ("DEP-PRC", "Procurement", {"LOC-SIN": 1}),
        ("DEP-RSK", "Risk", {"LOC-SIN": 1}),
    ]),
]

# level code, label, rank (1 = top), headcount, loaded USD per hour
LEVELS = [
    ("C", "C-suite", 1, 6, 350),
    ("GM", "General Manager", 2, 9, 230),
    ("SM", "Senior Manager", 3, 22, 170),
    ("M", "Manager", 4, 45, 130),
    ("AM", "Assistant Manager / Lead", 5, 60, 100),
    ("SE", "Senior Executive / Engineer", 6, 80, 80),
    ("E", "Executive / Engineer", 7, 58, 60),
    ("A", "Associate / Technician", 8, 20, 45),
]
LEVEL_RATE = {code: rate for code, _, _, _, rate in LEVELS}
LEVEL_RANK = {code: rank for code, _, rank, _, _ in LEVELS}
LEVEL_LABEL = {code: label for code, label, _, _, _ in LEVELS}

# C-suite seats: (title, division)
C_SUITE = [
    ("Group Chief Executive Officer", "DIV-CF"),
    ("Chief Financial Officer", "DIV-CF"),
    ("Chief Human Resources Officer", "DIV-CF"),
    ("Chief Technology Officer", "DIV-ITD"),
    ("Chief Operating Officer", "DIV-CSO"),
    ("Chief Data Officer", "DIV-ADL"),
]
GM_SEATS = {"DIV-NI": 2, "DIV-EG": 2, "DIV-CR": 1, "DIV-CSO": 1, "DIV-ITD": 1, "DIV-ADL": 1, "DIV-CF": 1}
# which C-suite member each division's GMs report to
DIVISION_EXEC = {"DIV-NI": "Chief Technology Officer", "DIV-EG": "Group Chief Executive Officer",
                 "DIV-CR": "Group Chief Executive Officer", "DIV-CSO": "Chief Operating Officer",
                 "DIV-ITD": "Chief Technology Officer", "DIV-ADL": "Chief Data Officer",
                 "DIV-CF": "Chief Financial Officer"}

# Money and time assumptions, surfaced in the UI as stated assumptions (PRD risk R2)
FINANCE = {
    "currency": "USD",
    "loaded_rate_by_level": LEVEL_RATE,
    "blended_rate_amt": 100,
    "expert_search_hours_before": 16,
    "expert_search_hours_after": 0.25,
    "consultant_day_rate_amt": {"default": 4000, "Data & AI": 5500, "Cloud & Platform": 5000, "Security": 6500,
                                "Network": 4000, "BSS/OSS": 4500, "Management": 3500},
    "recruitment_cost_pct_of_salary": 0.25,
    "working_hours_per_day": 8,
    "win_probability_default": 0.35,
    "match_weights": {"skill": 0.40, "project": 0.20, "domain": 0.15, "recency": 0.15, "adjacent": 0.10},
    "role_fill_threshold": 0.70,
    "reskill_band": [0.60, 0.80],
    "inference_confidence": {"base": 0.55, "per_evidence": 0.11, "max_evidence": 3},
    "project_saturation": 2.0,
    "adjacency_transfer": 0.8,
    "recency_by_year": {"2026": 1.0, "2025": 0.85, "2024": 0.7, "older": 0.5, "none": 0.3},
}

TIMELINE_START = "2025-01-01"
TIMELINE_END = "2026-09-30"
