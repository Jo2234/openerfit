FROM node:24-bookworm-slim

WORKDIR /app
RUN npm install -g pnpm@12.11.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# tsx is a devDependency required by the production server.
RUN pnpm install --frozen-lockfile --prod=false
COPY . .
RUN pnpm build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    QLOO_CACHE_DIR=/tmp/qloo-cache
USER node
EXPOSE 10000
CMD ["node_modules/.bin/tsx", "src/server/main.ts"]
