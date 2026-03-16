FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 11000

ENV API_DELAY_MS=1000 \
    MDNS_ENABLED=0

CMD ["node", "server.js"]
