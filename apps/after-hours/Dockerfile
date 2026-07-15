FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY packages/participant-ticket ./packages/participant-ticket
COPY packages/agent-integrity ./packages/agent-integrity
COPY apps/after-hours/package.json apps/after-hours/package-lock.json ./apps/after-hours/
RUN cd apps/after-hours && npm ci --omit=dev
COPY apps/after-hours/src ./apps/after-hours/src
COPY apps/after-hours/scripts ./apps/after-hours/scripts
WORKDIR /app/apps/after-hours
EXPOSE 3006
CMD ["node", "src/server.mjs"]
