# Cloud Run용 Next.js 컨테이너 (web3platform Dockerfile 패턴 참조)

# 1단계: 빌드 환경
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# 2단계: 실행 환경
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

COPY --from=builder /app/next.config.* ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

CMD ["npm", "start"]
