FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npx vite build && npm prune --omit=dev
ENV NODE_ENV=production PORT=3001 DATA_DIR=/data
EXPOSE 3001
CMD ["node", "server/index.js"]
