FROM node:22-bookworm-slim
WORKDIR /app
COPY packages/participant-ticket packages/participant-ticket
COPY packages/agent-integrity packages/agent-integrity
COPY packages/leaderboard packages/leaderboard
COPY packages/request-budget packages/request-budget
COPY apps/evidence-room/package.json apps/evidence-room/package-lock.json* apps/evidence-room/
RUN cd apps/evidence-room && npm ci --omit=dev
COPY apps/evidence-room apps/evidence-room
WORKDIR /app/apps/evidence-room
ENV NODE_ENV=production
EXPOSE 3009
CMD ["npm", "start"]
