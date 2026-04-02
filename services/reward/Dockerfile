FROM node:20-bookworm-slim

WORKDIR /app

COPY services/firebase/package*.json /app/services/firebase/
WORKDIR /app/services/firebase
RUN npm install --no-audit --no-fund

COPY services/reward/package*.json /app/services/reward/
WORKDIR /app/services/reward
RUN npm install --no-audit --no-fund

COPY services/firebase/firebaseAdmin.js /app/services/firebase/firebaseAdmin.js
COPY services/reward /app/services/reward

ENV PORT=3005
EXPOSE 3005

CMD ["node", "index.js"]
