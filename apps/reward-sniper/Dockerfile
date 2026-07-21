FROM node:22-alpine

WORKDIR /app

COPY packages/participant-ticket ./packages/participant-ticket
COPY packages/leaderboard ./packages/leaderboard
COPY packages/request-budget ./packages/request-budget
COPY apps/reward-sniper/package.json apps/reward-sniper/package-lock.json ./apps/reward-sniper/

WORKDIR /app/apps/reward-sniper
RUN npm ci --omit=dev

COPY apps/reward-sniper/src ./src
COPY apps/reward-sniper/web/index.html ./web/index.html
COPY apps/reward-sniper/web/main.js ./web/main.js
COPY apps/reward-sniper/web/style.css ./web/style.css

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3010 \
    STATE_FILE=/data/reward-sniper-state.json

EXPOSE 3010

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3010/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
