"""Build data/skillbridge.db (SQLite) from schema.sql and the seed CSVs.

Usage: python data/generator/build_db.py [--keep-ai]
--keep-ai keeps the precomputed AI tables (inferred_skills, embeddings, llm_cache, ai_audit) from an existing DB,
so a data rebuild does not force a full re-run of the LLM precompute.
"""
import csv
import sqlite3
import sys
from pathlib import Path

from generate import TABLE_ORDER

DATA = Path(__file__).resolve().parent.parent
DB = DATA / "skillbridge.db"
AI_TABLES = ["inferred_skills", "embeddings", "llm_cache", "ai_audit"]


def main():
    keep = {}
    if "--keep-ai" in sys.argv and DB.exists():
        old = sqlite3.connect(DB)
        for t in AI_TABLES:
            try:
                cur = old.execute(f"SELECT * FROM {t}")
                keep[t] = ([d[0] for d in cur.description], cur.fetchall())
            except sqlite3.Error:
                pass
        old.close()
    if DB.exists():
        DB.unlink()
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = OFF")
    con.executescript((DATA / "schema.sql").read_text(encoding="utf-8"))
    for t in TABLE_ORDER:
        with open(DATA / "seed" / f"{t}.csv", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        cols = list(rows[0].keys())
        con.executemany(f"INSERT INTO {t} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                        [[None if r[c] == "" else r[c] for c in cols] for r in rows])
    import json
    fp = json.loads((DATA / "seed" / "finance_params.json").read_text(encoding="utf-8"))
    con.executemany("INSERT INTO finance_params (key, value) VALUES (?, ?)", [(k, json.dumps(v)) for k, v in fp.items()])
    for t, (cols, rows) in keep.items():
        con.executemany(f"INSERT INTO {t} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", rows)
    con.commit()
    con.execute("PRAGMA foreign_keys = ON")
    bad = con.execute("PRAGMA foreign_key_check").fetchall()
    con.close()
    if bad:
        raise SystemExit(f"foreign key violations: {bad[:5]}")
    print(f"Built {DB} ({DB.stat().st_size // 1024} KB){' with AI tables kept' if keep else ''}")


if __name__ == "__main__":
    main()
