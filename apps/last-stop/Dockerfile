FROM rust:1.89-bookworm AS native
WORKDIR /build
COPY apps/last-stop/native/harness/Cargo.toml apps/last-stop/native/harness/Cargo.lock ./harness/
COPY apps/last-stop/native/harness/src ./harness/src
COPY apps/last-stop/native/dist/last_stop_program.so ./dist/last_stop_program.so
RUN cargo build --release --manifest-path harness/Cargo.toml

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY packages/participant-ticket ./packages/participant-ticket
COPY packages/agent-integrity ./packages/agent-integrity
COPY apps/last-stop/package.json apps/last-stop/package-lock.json ./apps/last-stop/
RUN cd apps/last-stop && npm ci --omit=dev
COPY apps/last-stop/src ./apps/last-stop/src
COPY apps/last-stop/native/dist/last_stop_program.so ./apps/last-stop/native/dist/last_stop_program.so
COPY --from=native /build/harness/target/release/last-stop-harness ./apps/last-stop/native/harness/target/release/last-stop-harness
WORKDIR /app/apps/last-stop
EXPOSE 3005 2222
CMD ["node", "src/server.mjs"]
