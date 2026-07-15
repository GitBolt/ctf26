FROM node:22-bookworm-slim
WORKDIR /app
COPY packages/participant-ticket packages/participant-ticket
COPY packages/agent-integrity packages/agent-integrity
COPY apps/player-two/package.json apps/player-two/package-lock.json* apps/player-two/
RUN cd apps/player-two && npm install --omit=dev
COPY apps/player-two apps/player-two
WORKDIR /app/apps/player-two
ENV NODE_ENV=production
CMD ["npm", "start"]
