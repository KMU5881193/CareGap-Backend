FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack pnpm install --frozen-lockfile
COPY src ./src
COPY scripts ./scripts
COPY tsconfig*.json ./
RUN corepack pnpm run build
RUN mkdir /app/.runtime && chown node:node /app/.runtime
USER node
EXPOSE 4320
CMD ["node", "--import", "tsx", "scripts/integrated-server.ts"]
