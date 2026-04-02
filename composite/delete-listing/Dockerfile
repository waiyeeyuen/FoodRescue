FROM node:20-bookworm-slim

WORKDIR /app

COPY composite/delete-listing/package*.json /app/composite/delete-listing/
WORKDIR /app/composite/delete-listing
RUN npm install --no-audit --no-fund

COPY composite/delete-listing /app/composite/delete-listing

EXPOSE 4005

CMD ["node", "index.js"]
