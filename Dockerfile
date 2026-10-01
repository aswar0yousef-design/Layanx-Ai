FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run security:check && npm run typecheck && npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN useradd --system --uid 10001 --create-home layanx && mkdir -p /app/data && chown -R layanx:layanx /app
USER layanx
EXPOSE 3000
ENV LAYANX_API_HOST=0.0.0.0
CMD ["node","dist/api.js"]
