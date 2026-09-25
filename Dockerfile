# Online connector for ChatGPT and Claude. Zero dependencies: just Node.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=8787 PERSONAL_MEMORY_DATA=/data
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node", "src/http/server.js"]
