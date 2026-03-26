FROM node:20-bookworm-slim

WORKDIR /app

COPY composite/recommendation/package*.json /app/composite/recommendation/
WORKDIR /app/composite/recommendation
RUN npm install --no-audit --no-fund

COPY composite/recommendation /app/composite/recommendation

ENV PORT=4000
EXPOSE 4000

CMD ["node", "index.js"]
