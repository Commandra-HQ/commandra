FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY tsconfig.json ./

# Build
RUN pnpm --filter @commandra/shared build
RUN pnpm --filter @commandra/api build

EXPOSE 3001 3002

CMD ["node", "apps/api/dist/server.js"]
