FROM node:22-bookworm-slim
WORKDIR /app
COPY packages/participant-ticket packages/participant-ticket
COPY apps/st-genesis-airdrop/package.json apps/st-genesis-airdrop/package-lock.json* apps/st-genesis-airdrop/
RUN cd apps/st-genesis-airdrop && npm install --omit=dev
COPY apps/st-genesis-airdrop apps/st-genesis-airdrop
WORKDIR /app/apps/st-genesis-airdrop
ENV NODE_ENV=production
CMD ["npm", "start"]
