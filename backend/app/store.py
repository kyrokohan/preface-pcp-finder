"""Provider profile store: the agent's findings per Google place ID.

This is where non-Google facts about a practice accumulate. Google content itself is never
written here (Places terms), only the place ID as the key.
"""

import json
import sqlite3
import time
from pathlib import Path


class ProfileStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS profiles ("
            " place_id TEXT PRIMARY KEY,"
            " findings_json TEXT NOT NULL,"
            " updated_at REAL NOT NULL)"
        )
        self._conn.commit()

    def get(self, place_id: str, max_age_s: float) -> dict | None:
        row = self._conn.execute(
            "SELECT findings_json, updated_at FROM profiles WHERE place_id = ?", (place_id,)
        ).fetchone()
        if row is None or time.time() - row[1] > max_age_s:
            return None
        return json.loads(row[0])

    def put(self, place_id: str, findings: dict) -> None:
        self._conn.execute(
            "INSERT INTO profiles (place_id, findings_json, updated_at) VALUES (?, ?, ?)"
            " ON CONFLICT(place_id) DO UPDATE SET"
            " findings_json = excluded.findings_json, updated_at = excluded.updated_at",
            (place_id, json.dumps(findings), time.time()),
        )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()
