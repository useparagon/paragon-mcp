FROM node:22.14.0-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:22.14.0-alpine AS runner

WORKDIR /app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/openapi ./openapi
COPY --from=builder /app/static ./static
RUN npm install --only=production

CMD ["node", "dist/index.mjs"]

EXPOSE 3001