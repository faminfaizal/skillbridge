"""Positions: one post per person, built from templates (role type duties, grade band duties and competencies).

No randomness: build_positions() runs after everything else and draws nothing from the world RNG, so every other
seed table stays byte-identical. Gemini plays no part in writing posts.
"""
import json

from taxonomy import ARCHETYPES, SKILL_BY_NAME

# Three duties per role type: what the post is there to do. Grade bands add scope (BAND_DUTIES) and competencies.
POSITION_DUTIES = {
    "Access Network Engineer": ["Plan, configure and maintain fibre access equipment (OLT and GPON) for assigned exchanges.",
                                "Diagnose access faults and restore service within agreed targets.",
                                "Test new fibre builds and sign off acceptance records."],
    "Core Network Engineer": ["Design and operate the IP/MPLS core and optical transport network.",
                              "Manage routing policy (BGP) and capacity changes with minimal customer impact.",
                              "Lead root-cause analysis for core and transport incidents."],
    "Network Test Engineer": ["Write and run acceptance and regression tests for network equipment and software releases.",
                              "Maintain the test lab, test plans and fault reproduction set-ups.",
                              "Report defects to vendors and verify their fixes."],
    "Field Engineer": ["Install, splice and test fibre and customer equipment in the field.",
                       "Respond to faults and outages in the assigned region, including after-hours call-outs.",
                       "Keep job records, test results and safety checks complete and on time."],
    "Enterprise Solutions Consultant": ["Own relationships with assigned enterprise customers and grow account revenue.",
                                        "Shape customer needs into connectivity and digital solutions with pre-sales.",
                                        "Prepare proposals and commercial cases, and track delivery to the promised outcome."],
    "Government Account Manager": ["Manage public-sector accounts and the tender pipeline.",
                                   "Prepare compliant bids and proposals against government procurement rules.",
                                   "Coordinate delivery teams so contracted services meet service levels."],
    "SME Business Executive": ["Win and grow small and medium business customers in the assigned territory.",
                               "Recommend the right mix of connectivity and digital products for each customer.",
                               "Keep the sales pipeline, forecasts and customer records current."],
    "Pre-sales Architect": ["Design technical solutions that answer customer requirements and bids.",
                            "Size, price and document the solution with delivery and product teams.",
                            "Present designs to customers and answer technical questions in tenders."],
    "Broadband Product Specialist": ["Manage the broadband product range, pricing and roadmap.",
                                     "Track take-up, churn and customer feedback, and act on what they show.",
                                     "Work with marketing and channels to launch and promote offers."],
    "Mobile Product Specialist": ["Manage mobile plans, devices and the 5G product roadmap.",
                                  "Set pricing and bundles with finance and marketing.",
                                  "Monitor product performance and customer retention."],
    "Retail Channel Executive": ["Run sales and service performance for assigned retail stores and partners.",
                                 "Train and support channel staff on products and processes.",
                                 "Use sales data to plan stock, promotions and targets."],
    "Marketing Analyst": ["Measure campaign and customer-journey performance across channels.",
                          "Build dashboards and analyses that guide marketing spend.",
                          "Segment customers and test offers to improve retention."],
    "Customer Service Executive": ["Handle customer contacts by phone and chat, and resolve requests at first contact where possible.",
                                   "Record complaints accurately and escalate what cannot be fixed on the call.",
                                   "Meet quality, response-time and satisfaction targets."],
    "Escalations Specialist": ["Own escalated complaints and serious service failures through to resolution.",
                               "Coordinate network, field and billing teams on each escalated case.",
                               "Find recurring causes and propose fixes to prevent repeat complaints."],
    "Field Service Coordinator": ["Schedule and dispatch field crews against fault and installation demand.",
                                  "Track jobs to completion and keep customers informed.",
                                  "Manage service tickets and field service levels."],
    "Billing Systems Analyst": ["Support and change the billing, rating and order management systems.",
                                "Investigate billing errors and disputes and correct their cause.",
                                "Write and test SQL and configuration changes for new products and prices."],
    "OSS Engineer": ["Maintain network inventory and network management systems.",
                     "Build integrations and reports that keep operational data accurate.",
                     "Support network teams with data, monitoring and automation."],
    "Cloud Engineer": ["Build and run cloud and container platforms (Kubernetes, Docker).",
                       "Automate infrastructure and deployment pipelines.",
                       "Keep platforms secure, observable and within cost targets."],
    "Security Analyst": ["Monitor security events and respond to incidents.",
                         "Assess network and application security and track remediation.",
                         "Maintain threat intelligence and security controls."],
    "Software Engineer": ["Design, build and test web applications and APIs.",
                          "Review code and keep services reliable and maintainable.",
                          "Work with product owners to deliver features in short iterations."],
    "Data Engineer": ["Build and operate data pipelines and the data warehouse.",
                      "Make data from network, customer and finance systems reliable and available.",
                      "Support analysts and data scientists with well-modelled datasets."],
    "Data Scientist": ["Build statistical and machine-learning models for business questions.",
                       "Turn analysis into clear findings and recommendations.",
                       "Monitor models in use and improve them over time."],
    "AI Engineer": ["Build and deploy AI applications, including language-model features.",
                    "Integrate models with business systems through APIs.",
                    "Evaluate model quality, safety and cost in production."],
    "Finance Analyst": ["Prepare budgets, forecasts and management reports.",
                        "Analyse costs, margins and investment cases.",
                        "Support business units with financial insight for decisions."],
    "HR Business Partner": ["Advise managers on workforce planning, hiring and performance.",
                            "Run talent and learning programmes for the business unit.",
                            "Use workforce data to find risks and opportunities."],
    "Strategy Analyst": ["Research markets and competitors to inform company strategy.",
                         "Build business cases and track strategic initiatives.",
                         "Prepare material for leadership decisions."],
    "Procurement Executive": ["Run sourcing and tenders for goods and services.",
                              "Negotiate and manage supplier contracts.",
                              "Track supplier performance and spend against budget."],
    "Risk Analyst": ["Identify, assess and report enterprise risks.",
                     "Support internal audit and regulatory compliance reviews.",
                     "Track risk actions to closure with the business."],
    "General Manager": ["Lead the division's strategy, budget and performance.",
                        "Develop the division's leadership team and capabilities.",
                        "Represent the division with executives, customers and partners."],
    "Executive": ["Set company direction and priorities for the portfolio.",
                  "Hold leaders accountable for results, risk and culture.",
                  "Represent the company with the board, regulators and key partners."],
}
BAND_OF = {"A": "ic", "E": "ic", "SE": "ic", "AM": "lead", "M": "manager", "SM": "manager", "GM": "exec", "C": "exec"}
BAND_DUTIES = {
    "ic": ["Share know-how with colleagues and keep work documentation current."],
    "lead": ["Lead a small team day to day, allocate work and coach team members.",
             "Act as the escalation point for the team's technical questions."],
    "manager": ["Manage the department's people, budget and delivery commitments.",
                "Develop staff and plan the skills the department will need."],
    "exec": ["Approve major investments and resourcing decisions."],
}
BAND_COMPETENCIES = {
    "ic": ["Technical depth", "Problem solving", "Collaboration"],
    "lead": ["Team leadership", "Problem solving", "Stakeholder Management"],
    "manager": ["People Leadership", "Stakeholder Management", "Budgeting"],
    "exec": ["Strategic Planning", "People Leadership", "Change Management"],
}
# Posts without a department (C-suite, GMs) borrow the division's main role type for nice-to-have skills.
DIVISION_HOME_DEPT = {"DIV-NI": "DEP-CORE", "DIV-EG": "DEP-ENT", "DIV-CR": "DEP-MKT", "DIV-CSO": "DEP-CC",
                      "DIV-ITD": "DEP-APP", "DIV-ADL": "DEP-DS", "DIV-CF": "DEP-STR"}
EXEC_MUST = ["People Leadership", "Strategic Planning", "Stakeholder Management"]


def position_id(person_id):
    return "POS-" + person_id.split("-", 1)[1]


def requirements(p):
    """(must skill names, nice skill names) for a person's post."""
    dep = p["department_id"] or DIVISION_HOME_DEPT[p["division_id"]]
    _, core, adjacent = ARCHETYPES[dep]
    if p["level"] in ("C", "GM"):
        must, nice = list(EXEC_MUST), core[:2]
    else:
        must = list(core)
        nice = [s for s, w in sorted(adjacent.items(), key=lambda kv: (-kv[1], kv[0])) if w >= 0.3][:3]
    for c in BAND_COMPETENCIES[BAND_OF[p["level"]]]:
        if c in SKILL_BY_NAME and c not in must and c not in nice:
            nice.append(c)
    return must, [s for s in nice if s not in must]


def build_positions(w):
    people = w.rows("people")
    for p in people:
        band = BAND_OF[p["level"]]
        duties = POSITION_DUTIES.get(p["archetype"]) or POSITION_DUTIES[ARCHETYPES[p["department_id"] or DIVISION_HOME_DEPT[p["division_id"]]][0]]
        resp = (duties + BAND_DUTIES[band])[:5]
        comps = BAND_COMPETENCIES[band][:3]
        pid = position_id(p["id"])
        w.add("positions", id=pid, person_id=p["id"], title=p["title"], level=p["level"], level_rank=p["level_rank"],
              archetype=p["archetype"], division_id=p["division_id"], department_id=p["department_id"], team_id=p["team_id"],
              reports_to_id=position_id(p["manager_id"]) if p["manager_id"] else None,
              responsibilities=json.dumps(resp), competencies=json.dumps(comps))
        must, nice = requirements(p)
        for name in must:
            w.add("position_skills", position_id=pid, skill_id=SKILL_BY_NAME[name], must=1)
        for name in nice:
            w.add("position_skills", position_id=pid, skill_id=SKILL_BY_NAME[name], must=0)
