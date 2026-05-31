"""
CRUD helpers — thin wrappers over SQLAlchemy that keep ui/server.py clean.

Every function takes a db Session as its first argument so the HTTP layer
controls transaction scope.
"""

from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session as DbSession

from backend.database.models import (
    Session as SessionModel,
    Step1Requirement,
    Step2AgentBoard,
    Step3VendorInput,
    _uuid,
    _now,
)


# ── Session ────────────────────────────────────────────────────────────────────

def create_session(db: DbSession) -> SessionModel:
    session = SessionModel(id=_uuid())
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: DbSession, session_id: str) -> Optional[SessionModel]:
    return db.get(SessionModel, session_id)


def list_sessions(db: DbSession) -> List[dict]:
    rows = db.query(SessionModel).order_by(SessionModel.created_at.desc()).all()
    return [
        {
            "id":         r.id,
            "status":     r.status,
            "created_at": r.created_at.isoformat(),
            "updated_at": r.updated_at.isoformat(),
        }
        for r in rows
    ]


def delete_session(db: DbSession, session_id: str) -> bool:
    session = db.get(SessionModel, session_id)
    if session is None:
        return False
    db.delete(session)
    db.commit()
    return True


# ── Step 1 ─────────────────────────────────────────────────────────────────────

def save_step1(
    db: DbSession,
    session_id: str,
    text: str,
    summary: Optional[str] = None,
) -> SessionModel:
    session = db.get(SessionModel, session_id)
    if session is None:
        raise KeyError(session_id)

    if session.step1:
        session.step1.text = text
        session.step1.summary = summary
        session.step1.submitted_at = _now()
    else:
        step1 = Step1Requirement(session_id=session_id, text=text, summary=summary)
        session.step1 = step1   # set relationship directly so refresh_status sees it
        db.add(step1)

    session.refresh_status()
    db.commit()
    db.refresh(session)
    return session


# ── Step 2 ─────────────────────────────────────────────────────────────────────

def save_step2(
    db: DbSession,
    session_id: str,
    agents: List[str],
    configs: Optional[dict] = None,
) -> SessionModel:
    session = db.get(SessionModel, session_id)
    if session is None:
        raise KeyError(session_id)

    if session.step2:
        session.step2.agents = agents
        if configs is not None:
            session.step2.configs = configs
        session.step2.submitted_at = _now()
    else:
        step2 = Step2AgentBoard(session_id=session_id)
        step2.agents = agents
        if configs is not None:
            step2.configs = configs
        session.step2 = step2
        db.add(step2)

    session.refresh_status()
    db.commit()
    db.refresh(session)
    return session


# ── Step 3 ─────────────────────────────────────────────────────────────────────

def save_step3(
    db: DbSession,
    session_id: str,
    method: str,
    vendor_names: Optional[List[str]] = None,
) -> SessionModel:
    session = db.get(SessionModel, session_id)
    if session is None:
        raise KeyError(session_id)

    if session.step3:
        session.step3.method = method
        session.step3.vendor_names = vendor_names or []
        session.step3.submitted_at = _now()
    else:
        step3 = Step3VendorInput(session_id=session_id, method=method)
        step3.vendor_names = vendor_names or []
        session.step3 = step3
        db.add(step3)

    session.refresh_status()
    db.commit()
    db.refresh(session)
    return session
