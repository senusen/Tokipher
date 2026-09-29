FROM node:24-slim

# Chromium is only for the Spotify tokener. With SPOTIFY_ENABLED=false you can drop this layer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY vendor ./vendor
RUN mkdir -p cache && chown node:node cache

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8001 \
    BROWSER_PATH=/usr/bin/chromium \
    BROWSER_NO_SANDBOX=true

USER node
EXPOSE 8001
CMD ["node", "src/server.ts"]
