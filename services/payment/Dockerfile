FROM node:20-bookworm-slim

WORKDIR /app

COPY services/payment/package*.json /app/services/payment/
WORKDIR /app/services/payment
RUN npm install --no-audit --no-fund

COPY services/payment /app/services/payment
COPY services/firebase/firebaseAdmin.js /app/services/firebase/firebaseAdmin.js

ENV PORT=3003
EXPOSE 3003

CMD ["node", "index.js"]
