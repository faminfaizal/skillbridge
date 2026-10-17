"""In-memory world shared by the generator and the anchor planters."""
import datetime as dt
import random

from config import SEED
from taxonomy import SKILL_BY_NAME


class World:
    def __init__(self):
        self.rng = random.Random(SEED)
        self.t = {}            # table name -> list of row dicts
        self.counters = {}
        self.locked = set()    # anchor people excluded from random assignment
        self.manifest = []     # story_manifest entries
        self.emails = set()

    # tables
    def rows(self, table):
        return self.t.setdefault(table, [])

    def add(self, table, **row):
        self.rows(table).append(row)
        return row

    def next_id(self, prefix, width=4):
        n = self.counters.get(prefix, 0) + 1
        self.counters[prefix] = n
        return f"{prefix}-{n:0{width}d}"

    def by_id(self, table, key="id"):
        return {r[key]: r for r in self.rows(table)}

    # people helpers
    def person(self, pid):
        for p in self.rows("people"):
            if p["id"] == pid:
                return p
        raise KeyError(pid)

    def people_where(self, **kw):
        return [p for p in self.rows("people") if all(p.get(k) == v for k, v in kw.items())]

    def skills_of(self, pid):
        return {r["skill_id"]: r for r in self.rows("person_skills") if r["person_id"] == pid}

    def set_skill(self, pid, skill_name, level, source="declared", year=2026):
        sid = SKILL_BY_NAME[skill_name]
        for r in self.rows("person_skills"):
            if r["person_id"] == pid and r["skill_id"] == sid:
                r.update(level=level, source=source, last_used_year=year)
                return r
        return self.add("person_skills", person_id=pid, skill_id=sid, level=level, source=source, last_used_year=year)

    def drop_skill(self, pid, skill_name):
        sid = SKILL_BY_NAME[skill_name]
        self.t["person_skills"] = [r for r in self.rows("person_skills") if not (r["person_id"] == pid and r["skill_id"] == sid)]

    # dates
    def rand_date(self, start="2025-01-01", end="2026-09-30"):
        a, b = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
        return (a + dt.timedelta(days=self.rng.randint(0, (b - a).days))).isoformat()

    def expect(self, anchor, feature, description, checks):
        self.manifest.append({"anchor": anchor, "feature": feature, "description": description, "expected": checks})
