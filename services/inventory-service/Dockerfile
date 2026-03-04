FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
ENV APIKEY=AIzaSyBuW8dV9QHxzhEJJ8UYXtc5NECBkzBkm1Q
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm","start"]