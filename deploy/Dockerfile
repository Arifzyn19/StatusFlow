# Optional Docker deployment (not required — PM2 + bare Node is primary).
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/config/package.json packages/config/package.json
RUN npm install --omit=dev || npm install
COPY . .
RUN npm run build --workspace=apps/api && npm run build --workspace=apps/web
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0
EXPOSE 3001 3000
CMD ["node", "apps/api/dist/index.js"]
