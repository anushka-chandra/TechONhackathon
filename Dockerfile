# Backend (FastAPI) image for Railway.
# Matches our tested local runtime: Python 3.9.
FROM python:3.9-slim

# Faster, cleaner Python in containers
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first (better layer caching)
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy only what the backend needs (frontend stays out of this image)
COPY ui ./ui
COPY backend ./backend
COPY multi_agent_system ./multi_agent_system

EXPOSE 8000

# Railway injects $PORT; default to 8000 locally. Shell form so $PORT expands.
CMD uvicorn ui.server:app --host 0.0.0.0 --port ${PORT:-8000}
