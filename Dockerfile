# VoxFlow Studio site — Coolify-ready (static build served by nginx)
# Build:  docker build --build-arg SITE_URL=https://your-domain.com -t voxflow-web .
# Run:    docker run -p 8080:80 voxflow-web

FROM node:22-alpine AS build
WORKDIR /app
ARG SITE_URL=https://www.example.com
ENV SITE_URL=${SITE_URL}
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Optional: mount or COPY your notarized .dmg into /usr/share/nginx/html/downloads/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
