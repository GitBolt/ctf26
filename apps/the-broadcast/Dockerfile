FROM node:22-bookworm-slim
WORKDIR /app
COPY packages/participant-ticket packages/participant-ticket
COPY packages/agent-integrity packages/agent-integrity
COPY packages/leaderboard packages/leaderboard
COPY packages/request-budget packages/request-budget
COPY apps/the-broadcast/package.json apps/the-broadcast/package-lock.json* apps/the-broadcast/
RUN cd apps/the-broadcast && npm install --omit=dev
COPY apps/the-broadcast apps/the-broadcast
WORKDIR /app/apps/the-broadcast
ENV NODE_ENV=production
CMD ["npm", "start"]
