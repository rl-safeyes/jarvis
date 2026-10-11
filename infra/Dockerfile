FROM node:24-bullseye-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:24-bullseye-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/tsx", "apps/api/src/server.ts"]
