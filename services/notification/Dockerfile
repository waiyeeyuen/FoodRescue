FROM node:20-bookworm-slim

WORKDIR /app

COPY services/firebase/package*.json /app/services/firebase/
WORKDIR /app/services/firebase
RUN npm install --no-audit --no-fund

COPY services/notification/package*.json /app/services/notification/
WORKDIR /app/services/notification
RUN npm install --no-audit --no-fund

COPY services/notification /app/services/notification
COPY services/firebase/firebaseAdmin.js /app/services/firebase/firebaseAdmin.js

ENV PORT=3006
EXPOSE 3006

CMD ["node", "index.js"]
