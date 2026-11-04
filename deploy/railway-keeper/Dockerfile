FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# scripts/keeper.mjs finds near-api-js through sdk/package.json, so the bundle has a small sdk folder with that one dependency
COPY sdk/package.json ./sdk/package.json
RUN cd sdk && npm install --omit=dev --no-audit --no-fund
COPY scripts ./scripts
# the key comes only from the Railway variable KEEPER_SECRET_KEY; the other settings are plain variables (KEEPER_RPC_URL, KEEPER_CONTRACT, KEEPER_ACCOUNT, KEEPER_INTERVAL, KEEPER_LOOKBACK)
CMD ["sh", "-c", "exec node scripts/keeper.mjs --rpc-url \"$KEEPER_RPC_URL\" --contract \"$KEEPER_CONTRACT\" --account \"$KEEPER_ACCOUNT\" --interval \"${KEEPER_INTERVAL:-15}\" --lookback \"${KEEPER_LOOKBACK:-30}\""]
