FROM node:22-bookworm-slim AS build
WORKDIR /app
# Reproducible with a committed package-lock.json (npm ci); falls back to npm install.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY tsconfig.json ./
# scripts/ was missing before, so `npm run security:check` could not run in the image
COPY scripts ./scripts
COPY playbooks ./playbooks
COPY src ./src
RUN npm run security:check && npm run typecheck && npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/playbooks ./playbooks
RUN useradd --system --uid 10001 --create-home layanx && mkdir -p /app/data && chown -R layanx:layanx /app
USER layanx
ENV LAYANX_DATA_DIR=/app/data
EXPOSE 3000
# The container publishes the API on all interfaces, so it must never run
# without a token: pass LAYANX_API_TOKEN (e.g. docker run -e LAYANX_API_TOKEN=...).
# On a Windows PC use LayanX.cmd instead; it puts the authenticated gateway in front.
ENV LAYANX_API_HOST=0.0.0.0
CMD ["node","dist/api.js"]
