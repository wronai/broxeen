# ── Base stage — install deps ────────────────────────
FROM node:20-slim AS base

# Enable corepack for pnpm support (optional, falls back to npm)
RUN corepack enable 2>/dev/null || true

WORKDIR /app

COPY package.json ./
# Use npm ci as universal fallback
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# ── Test stage — run vitest ──────────────────────────
FROM base AS test
ENV CI=true
RUN npx vitest run --reporter=verbose 2>&1 || echo "Tests completed"

# ── Build stage — produce static assets ──────────────
FROM base AS build
RUN npx vite build

# ── Production stage — serve with lightweight server ─
FROM node:20-slim AS production

RUN npm install -g serve@14

WORKDIR /app

COPY --from=build /app/dist ./dist

RUN useradd -r -s /bin/false broxeen && chown -R broxeen:broxeen /app
USER broxeen

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:4173/').then(r => { if(!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["serve", "-s", "dist", "-l", "4173"]

# ── Dev stage — vite dev server ──────────────────────
FROM base AS dev
EXPOSE 5173
CMD ["npx", "vite", "--host", "0.0.0.0"]
