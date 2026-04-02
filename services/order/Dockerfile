FROM node:20-bookworm-slim

WORKDIR /app

COPY services/firebase/package*.json /app/services/firebase/
WORKDIR /app/services/firebase
RUN npm install --no-audit --no-fund

COPY services/order/package*.json /app/services/order/
WORKDIR /app/services/order
RUN npm install --no-audit --no-fund

COPY services/order /app/services/order
COPY services/firebase/firebaseAdmin.js /app/services/firebase/firebaseAdmin.js

ENV PORT=3004
EXPOSE 3004

CMD ["node", "index.js"]
