FROM rust:1.89-bookworm AS checker
WORKDIR /build
COPY apps/drift/native/harness/Cargo.toml apps/drift/native/harness/Cargo.lock ./
COPY apps/drift/native/harness/src ./src
RUN cargo build --locked --release

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3020 \
    DRIFT_CHECKER_PATH=/workspace/apps/drift/bin/drift-harness
WORKDIR /workspace/apps/drift
COPY apps/drift/package.json apps/drift/package-lock.json ./
COPY packages/participant-ticket /workspace/packages/participant-ticket
COPY packages/agent-integrity /workspace/packages/agent-integrity
COPY packages/leaderboard /workspace/packages/leaderboard
COPY packages/request-budget /workspace/packages/request-budget
RUN npm ci --omit=dev --ignore-scripts
COPY apps/drift/src ./src
COPY apps/drift/web ./web
COPY apps/drift/player-kit ./player-kit
COPY apps/drift/server-artifacts ./server-artifacts
COPY --from=checker /build/target/release/drift-harness ./bin/drift-harness
RUN test -s player-kit/dist/drift_vault.so && test -x bin/drift-harness
USER node
EXPOSE 3020
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:3020/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
CMD ["node", "src/service.mjs"]
