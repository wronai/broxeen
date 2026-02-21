FROM python:3.12-slim AS base

WORKDIR /app

# System deps for lxml
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libxml2-dev libxslt1-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# ── Test stage ───────────────────────────────────────
FROM base AS test
RUN pytest tests/ -v --tb=short

# ── Production stage ─────────────────────────────────
FROM base AS production

RUN useradd -r -s /bin/false chatbrowse
RUN mkdir -p /data/cache /data/contacts && chown -R chatbrowse:chatbrowse /data

ENV CACHE_DIR=/data/cache \
    CONTACTS_FILE=/data/contacts/contacts.json \
    PYTHONUNBUFFERED=1

USER chatbrowse
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8080/health').raise_for_status()"

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "30", "wsgi:application"]
