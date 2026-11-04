FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY vendor ./vendor
RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY vendor ./vendor
COPY package.json ./
# Streamable HTTP, read tools only; Railway gives the port in PORT and the proxy reaches the service on all interfaces
CMD ["sh", "-c", "exec node vendor/x207-mcp/dist/cli.js --http --host 0.0.0.0 --port ${PORT:-3207}"]
