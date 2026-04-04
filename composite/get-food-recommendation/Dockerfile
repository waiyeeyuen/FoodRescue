FROM node:20-bookworm-slim

WORKDIR /app

COPY composite/get-food-recommendation/package*.json /app/composite/get-food-recommendation/
WORKDIR /app/composite/get-food-recommendation
RUN npm install --no-audit --no-fund

COPY composite/get-food-recommendation /app/composite/get-food-recommendation

ENV PORT=4000
EXPOSE 4000

CMD ["node", "index.js"]
