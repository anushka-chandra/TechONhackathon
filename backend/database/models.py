"""
SQLAlchemy ORM table definitions.

Tables
------
sessions            one row per user journey through the 3-step flow
step1_requirements  requirement text + AI summary (Step 1)
step2_agent_boards  selected executive agents (Step 2)
step3_vendor_inputs vendor method + optional vendor names (Step 3)
"""

import json
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Text, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.engine import Base


def _now() -> datetime:
    return datetime.utcnow()


def _uuid() -> str:
    return str(uuid.uuid4())


# ── Sessions ───────────────────────────────────────────────────────────────────

class Session(Base):
    __tablename__ = "sessions"

    id:           Mapped[str]            = mapped_column(String(36), primary_key=True, default=_uuid)
    status:       Mapped[str]            = mapped_column(String(20), nullable=False, default="in_progress")
    created_at:   Mapped[datetime]       = mapped_column(DateTime, nullable=False, default=_now)
    updated_at:   Mapped[datetime]       = mapped_column(DateTime, nullable=False, default=_now, onupdate=_now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Relationships — one-to-one via uselist=False
    step1: Mapped[Optional["Step1Requirement"]] = relationship(
        back_populates="session", uselist=False, cascade="all, delete-orphan"
    )
    step2: Mapped[Optional["Step2AgentBoard"]]  = relationship(
        back_populates="session", uselist=False, cascade="all, delete-orphan"
    )
    step3: Mapped[Optional["Step3VendorInput"]] = relationship(
        back_populates="session", uselist=False, cascade="all, delete-orphan"
    )

    def refresh_status(self) -> None:
        """Recompute status based on which steps are present."""
        self.updated_at = _now()
        if self.step1 and self.step2 and self.step3:
            self.status = "complete"
            if self.completed_at is None:
                self.completed_at = _now()
        else:
            self.status = "in_progress"

    def to_dict(self) -> dict:
        return {
            "id":           self.id,
            "status":       self.status,
            "created_at":   self.created_at.isoformat() if self.created_at else None,
            "updated_at":   self.updated_at.isoformat() if self.updated_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "step1": self.step1.to_dict() if self.step1 else None,
            "step2": self.step2.to_dict() if self.step2 else None,
            "step3": self.step3.to_dict() if self.step3 else None,
        }


# ── Step 1 — Requirements ──────────────────────────────────────────────────────

class Step1Requirement(Base):
    __tablename__ = "step1_requirements"

    id:           Mapped[int]            = mapped_column(primary_key=True, autoincrement=True)
    session_id:   Mapped[str]            = mapped_column(ForeignKey("sessions.id"), nullable=False, unique=True)
    text:         Mapped[str]            = mapped_column(Text, nullable=False)
    summary:      Mapped[Optional[str]]  = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime]       = mapped_column(DateTime, nullable=False, default=_now)

    session: Mapped["Session"] = relationship(back_populates="step1")

    def to_dict(self) -> dict:
        return {
            "text":         self.text,
            "summary":      self.summary,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
        }


# ── Step 2 — Agent Board ───────────────────────────────────────────────────────

class Step2AgentBoard(Base):
    __tablename__ = "step2_agent_boards"

    id:           Mapped[int]            = mapped_column(primary_key=True, autoincrement=True)
    session_id:   Mapped[str]            = mapped_column(ForeignKey("sessions.id"), nullable=False, unique=True)
    agents_json:  Mapped[str]            = mapped_column(Text, nullable=False)   # JSON-encoded list
    configs_json: Mapped[Optional[str]]  = mapped_column(Text, nullable=True)    # JSON {agent_id: personality}
    submitted_at: Mapped[datetime]       = mapped_column(DateTime, nullable=False, default=_now)

    session: Mapped["Session"] = relationship(back_populates="step2")

    # Convenience helpers
    @property
    def agents(self) -> list:
        return json.loads(self.agents_json)

    @agents.setter
    def agents(self, value: list) -> None:
        self.agents_json = json.dumps(value)

    @property
    def configs(self) -> dict:
        return json.loads(self.configs_json) if self.configs_json else {}

    @configs.setter
    def configs(self, value: dict) -> None:
        self.configs_json = json.dumps(value) if value else None

    def to_dict(self) -> dict:
        return {
            "agents":       self.agents,
            "configs":      self.configs,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
        }


# ── Step 3 — Vendor Input ──────────────────────────────────────────────────────

class Step3VendorInput(Base):
    __tablename__ = "step3_vendor_inputs"

    id:                Mapped[int]            = mapped_column(primary_key=True, autoincrement=True)
    session_id:        Mapped[str]            = mapped_column(ForeignKey("sessions.id"), nullable=False, unique=True)
    method:            Mapped[str]            = mapped_column(String(20), nullable=False)   # "upload" | "search"
    vendor_names_json: Mapped[Optional[str]]  = mapped_column(Text, nullable=True)          # JSON list or NULL
    vendor_text:       Mapped[Optional[str]]  = mapped_column(Text, nullable=True)          # extracted PDF text
    submitted_at:      Mapped[datetime]       = mapped_column(DateTime, nullable=False, default=_now)

    session: Mapped["Session"] = relationship(back_populates="step3")

    @property
    def vendor_names(self) -> list:
        return json.loads(self.vendor_names_json) if self.vendor_names_json else []

    @vendor_names.setter
    def vendor_names(self, value: list) -> None:
        self.vendor_names_json = json.dumps(value) if value else None

    def to_dict(self) -> dict:
        return {
            "method":       self.method,
            "vendor_names": self.vendor_names,
            "vendor_text":  self.vendor_text,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
        }
