FROM node:20-bookworm-slim

WORKDIR /app

COPY composite/remove-expired/package*.json /app/composite/remove-expired/
WORKDIR /app/composite/remove-expired
RUN npm install --no-audit --no-fund

COPY composite/remove-expired /app/composite/remove-expired
COPY services/firebase/firebaseAdmin.js /app/services/firebase/firebaseAdmin.js

ENV PORT=4003
EXPOSE 4003

CMD ["node", "index.js"]
