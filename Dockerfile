FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Europe/Moscow
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY config ./config
COPY package.json ./
USER node
# миграции применяются при каждом старте (идемпотентно)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
