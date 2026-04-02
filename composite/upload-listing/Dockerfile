FROM node:20-bookworm-slim

WORKDIR /app

COPY composite/upload-listing/package*.json /app/composite/upload-listing/
WORKDIR /app/composite/upload-listing
RUN npm install --no-audit --no-fund

COPY composite/upload-listing /app/composite/upload-listing

ENV PORT=4002
EXPOSE 4002

CMD ["node", "index.js"]
