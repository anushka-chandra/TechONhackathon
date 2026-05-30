"""
Data models for each step of the user flow.

Step 1 — Requirements   : free-text procurement description
Step 2 — Agent Board    : which AI executives the user selected
Step 3 — Vendor Input   : how the user wants to provide vendor data
Session                 : aggregates all three steps + metadata
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field
import uuid


# ── Enums ──────────────────────────────────────────────────────────────────────

class AgentId(str, Enum):
    CEO = "ceo"
    CTO = "cto"
    CFO = "cfo"
    CSO = "cso"


class VendorMethod(str, Enum):
    UPLOAD = "upload"       # user will upload PDF / spreadsheet
    AI_SEARCH = "search"    # agents search the web automatically


class SessionStatus(str, Enum):
    IN_PROGRESS = "in_progress"   # user is still stepping through the flow
    COMPLETE    = "complete"      # all three steps submitted
    ABANDONED   = "abandoned"     # session was never completed


# ── Step models ────────────────────────────────────────────────────────────────

class Step1Requirements(BaseModel):
    """Captured at the end of Step 1 (Define your requirements)."""

    text: str = Field(
        ...,
        min_length=1,
        description="Raw free-text requirement entered by the user",
    )
    summary: Optional[str] = Field(
        None,
        description="Short summary produced by the local or HuggingFace summariser",
    )
    submitted_at: datetime = Field(default_factory=datetime.utcnow)


class Step2AgentBoard(BaseModel):
    """Captured when the user clicks 'Apply Selection' in Step 2."""

    agents: List[AgentId] = Field(
        ...,
        min_length=1,
        description="Agent IDs the user selected for the evaluation board",
    )
    submitted_at: datetime = Field(default_factory=datetime.utcnow)


class Step3VendorInput(BaseModel):
    """Captured when the user picks a vendor method in Step 3."""

    method: VendorMethod = Field(
        ...,
        description="Whether the user will upload files or use AI web search",
    )
    # Populated once file upload or AI search completes (future use)
    vendor_names: List[str] = Field(
        default_factory=list,
        description="Vendor names identified/uploaded — filled by a later pipeline step",
    )
    submitted_at: datetime = Field(default_factory=datetime.utcnow)


# ── Top-level session ──────────────────────────────────────────────────────────

class Session(BaseModel):
    """One complete user journey through the three-step onboarding flow."""

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique session identifier (UUID4)",
    )
    status: SessionStatus = Field(
        default=SessionStatus.IN_PROGRESS,
        description="Lifecycle status of this session",
    )

    # Steps — each is None until that step is submitted
    step1: Optional[Step1Requirements] = None
    step2: Optional[Step2AgentBoard]   = None
    step3: Optional[Step3VendorInput]  = None

    created_at:  datetime = Field(default_factory=datetime.utcnow)
    updated_at:  datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None

    def advance(self) -> None:
        """Recompute status and timestamps after any step is written."""
        self.updated_at = datetime.utcnow()
        if self.step1 and self.step2 and self.step3:
            self.status = SessionStatus.COMPLETE
            if self.completed_at is None:
                self.completed_at = datetime.utcnow()
        else:
            self.status = SessionStatus.IN_PROGRESS
