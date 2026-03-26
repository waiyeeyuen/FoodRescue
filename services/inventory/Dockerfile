FROM node:20-bookworm-slim

WORKDIR /app

COPY services/firebase/package*.json /app/services/firebase/
WORKDIR /app/services/firebase
RUN npm install --no-audit --no-fund

COPY services/inventory/package*.json /app/services/inventory/
WORKDIR /app/services/inventory
RUN npm install --no-audit --no-fund

COPY services/inventory /app/services/inventory
COPY services/firebase/firebaseAdmin.js /app/services/firebase/firebaseAdmin.js

ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
