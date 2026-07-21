FROM node:22-bookworm-slim
WORKDIR /app
COPY packages/participant-ticket packages/participant-ticket
COPY packages/agent-integrity packages/agent-integrity
COPY packages/leaderboard packages/leaderboard
COPY packages/request-budget packages/request-budget
COPY apps/second-key/package.json apps/second-key/package-lock.json* apps/second-key/
RUN cd apps/second-key && npm ci --omit=dev
COPY apps/second-key apps/second-key
WORKDIR /app/apps/second-key
ENV NODE_ENV=production
EXPOSE 3011
CMD ["npm", "start"]
