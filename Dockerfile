# VoxFlow Studio 2.3.0 — Node server (estatico + API Postgres/Stripe/n8n)
FROM node:22-alpine AS build
WORKDIR /app
ARG SITE_URL=https://voxflow.iareal.net
ENV SITE_URL=${SITE_URL}
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 STORAGE_LOCAL_DIR=/app/storage
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
USER node
CMD ["node", "server/server.mjs"]
