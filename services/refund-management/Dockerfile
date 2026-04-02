FROM node:20-bookworm-slim

WORKDIR /app/services/refund-management

COPY services/refund-management/package*.json ./
RUN npm install --no-audit --no-fund

COPY services/refund-management ./

CMD ["npm", "start"]

