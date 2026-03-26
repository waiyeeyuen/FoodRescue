FROM node:20-bookworm-slim

WORKDIR /app

COPY services/firebase/package*.json /app/services/firebase/
WORKDIR /app/services/firebase
RUN npm install --no-audit --no-fund

COPY services/account/package*.json /app/services/account/
WORKDIR /app/services/account
RUN npm install --no-audit --no-fund

COPY services/account /app/services/account
COPY services/firebase/firebaseAdmin.js /app/services/firebase/firebaseAdmin.js

ENV PORT=3001
EXPOSE 3001

CMD ["node", "index.js"]
