FROM node:20-bookworm-slim

WORKDIR /app

COPY composite/checkout/package*.json /app/composite/checkout/
WORKDIR /app/composite/checkout
RUN npm install --no-audit --no-fund

COPY composite/checkout /app/composite/checkout

ENV PORT=4004
EXPOSE 4004

CMD ["node", "index.js"]
