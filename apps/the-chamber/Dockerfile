FROM node:22-bookworm-slim
WORKDIR /app
COPY packages/participant-ticket packages/participant-ticket
COPY packages/agent-integrity packages/agent-integrity
COPY packages/leaderboard packages/leaderboard
COPY packages/request-budget packages/request-budget
COPY apps/the-chamber/package.json apps/the-chamber/package-lock.json* apps/the-chamber/
RUN cd apps/the-chamber && npm ci --omit=dev
COPY apps/the-chamber apps/the-chamber
WORKDIR /app/apps/the-chamber
ENV NODE_ENV=production
EXPOSE 3012
CMD ["npm", "start"]
