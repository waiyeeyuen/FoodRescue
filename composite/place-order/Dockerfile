FROM node:20-bookworm-slim

WORKDIR /app

COPY composite/place-order/package*.json /app/composite/place-order/
WORKDIR /app/composite/place-order
RUN npm install --no-audit --no-fund

COPY composite/place-order /app/composite/place-order

ENV PORT=4001
EXPOSE 4001

CMD ["node", "index.js"]
