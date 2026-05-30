"""
Database engine and session factory.

Uses SQLite (file at backend/data/nexus.db) — zero-config, no server needed.
Switch to PostgreSQL later by changing DATABASE_URL in the environment:
  DATABASE_URL=postgresql+psycopg2://user:pass@host/dbname
"""

import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# ── Path ───────────────────────────────────────────────────────────────────────
_HERE = Path(__file__).resolve().parent.parent   # backend/
DB_PATH = _HERE / "data" / "nexus.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}")

# ── Engine ─────────────────────────────────────────────────────────────────────
# check_same_thread=False is required for SQLite when used with FastAPI
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=False,          # set True to see SQL statements in logs
)

# ── Session factory ────────────────────────────────────────────────────────────
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ── Base class for all ORM models ──────────────────────────────────────────────
class Base(DeclarativeBase):
    pass


# ── FastAPI dependency ─────────────────────────────────────────────────────────
def get_db():
    """Yield a database session and close it when the request is done."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
