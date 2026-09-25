# Online connector for Claude and ChatGPT (web and phone apps). Zero dependencies: just Node.
FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir -p /data
ENV NODE_ENV=production PORT=8787 PERSONAL_MEMORY_DATA=/data
VOLUME ["/data"]
EXPOSE 8787
# Mounted volumes are often root-owned: fix ownership, then run as the unprivileged node user.
ENTRYPOINT ["/bin/sh", "-c", "chown -R node:node /data 2>/dev/null; exec su-exec node node src/http/server.js"]
