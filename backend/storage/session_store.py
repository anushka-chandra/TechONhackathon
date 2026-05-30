"""
File-based session store.

Layout on disk:
  backend/data/sessions.json          ← index: list of {id, status, created_at}
  backend/data/sessions/<id>.json     ← full Session object, one file per session

All public methods are synchronous and thread-safe (via a per-instance lock).
"""

from __future__ import annotations

import json
import threading
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from backend.models.session import (
    AgentId,
    Session,
    SessionStatus,
    Step1Requirements,
    Step2AgentBoard,
    Step3VendorInput,
    VendorMethod,
)

# Resolve paths relative to this file so the store works from any cwd
_HERE        = Path(__file__).resolve().parent.parent   # backend/
DATA_DIR     = _HERE / "data"
SESSIONS_DIR = DATA_DIR / "sessions"
INDEX_FILE   = DATA_DIR / "sessions.json"


class SessionStore:
    """
    Persists Session objects as individual JSON files.

    Usage
    -----
    store = SessionStore()               # uses default paths

    session = store.create_session()     # Step 0: open a session
    store.save_step1(session.id, text="Need CRM for 50 reps")
    store.save_step2(session.id, agents=["ceo","cfo"])
    store.save_step3(session.id, method="upload")

    session = store.get(session.id)      # reload at any time
    all     = store.list_all()           # summary index
    """

    def __init__(
        self,
        sessions_dir: Path = SESSIONS_DIR,
        index_file:   Path = INDEX_FILE,
    ) -> None:
        self._dir   = sessions_dir
        self._index = index_file
        self._lock  = threading.Lock()
        self._ensure_dirs()

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    def create_session(self) -> Session:
        """Open a new session (Step 0) and persist it immediately."""
        session = Session()
        self._write(session)
        self._update_index(session)
        return session

    def get(self, session_id: str) -> Optional[Session]:
        """Load a session by ID.  Returns None if not found."""
        path = self._path(session_id)
        if not path.exists():
            return None
        with self._lock:
            return Session.model_validate_json(path.read_text(encoding="utf-8"))

    def list_all(self) -> List[dict]:
        """Return the lightweight index (id, status, created_at) for all sessions."""
        with self._lock:
            if not self._index.exists():
                return []
            return json.loads(self._index.read_text(encoding="utf-8"))

    def delete(self, session_id: str) -> bool:
        """Remove a session from disk and the index.  Returns True if it existed."""
        path = self._path(session_id)
        if not path.exists():
            return False
        with self._lock:
            path.unlink()
            index = json.loads(self._index.read_text(encoding="utf-8"))
            index = [s for s in index if s["id"] != session_id]
            self._index.write_text(json.dumps(index, indent=2), encoding="utf-8")
        return True

    # ── Step writers ──────────────────────────────────────────────────────────

    def save_step1(
        self,
        session_id: str,
        text: str,
        summary: Optional[str] = None,
    ) -> Session:
        """Persist Step 1 (user's requirement text + optional summary)."""
        return self._patch(
            session_id,
            lambda s: setattr(
                s,
                "step1",
                Step1Requirements(text=text, summary=summary),
            ),
        )

    def save_step2(
        self,
        session_id: str,
        agents: List[str],
    ) -> Session:
        """Persist Step 2 (selected agent board)."""
        agent_ids = [AgentId(a) for a in agents]
        return self._patch(
            session_id,
            lambda s: setattr(s, "step2", Step2AgentBoard(agents=agent_ids)),
        )

    def save_step3(
        self,
        session_id: str,
        method: str,
        vendor_names: Optional[List[str]] = None,
    ) -> Session:
        """Persist Step 3 (vendor input method + optional vendor list)."""
        return self._patch(
            session_id,
            lambda s: setattr(
                s,
                "step3",
                Step3VendorInput(
                    method=VendorMethod(method),
                    vendor_names=vendor_names or [],
                ),
            ),
        )

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _ensure_dirs(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        if not self._index.exists():
            self._index.write_text("[]", encoding="utf-8")

    def _path(self, session_id: str) -> Path:
        return self._dir / f"{session_id}.json"

    def _write(self, session: Session) -> None:
        with self._lock:
            self._path(session.id).write_text(
                session.model_dump_json(indent=2),
                encoding="utf-8",
            )

    def _update_index(self, session: Session) -> None:
        with self._lock:
            index: List[dict] = json.loads(
                self._index.read_text(encoding="utf-8")
            )
            # Replace existing entry or append
            entry = {
                "id":         session.id,
                "status":     session.status.value,
                "created_at": session.created_at.isoformat(),
                "updated_at": session.updated_at.isoformat(),
            }
            for i, row in enumerate(index):
                if row["id"] == session.id:
                    index[i] = entry
                    break
            else:
                index.append(entry)
            self._index.write_text(json.dumps(index, indent=2), encoding="utf-8")

    def _patch(self, session_id: str, mutate) -> Session:
        """Load → mutate → advance → save → re-index."""
        session = self.get(session_id)
        if session is None:
            raise KeyError(f"Session '{session_id}' not found")
        mutate(session)
        session.advance()
        self._write(session)
        self._update_index(session)
        return session


# Module-level singleton — import and use directly
store = SessionStore()
