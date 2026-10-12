FROM node:24-bullseye-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:24-bullseye-slim AS application
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/tsx", "apps/api/src/server.ts"]

ARG JARVIS_SOURCE_COMMIT=unconfigured
LABEL org.opencontainers.image.revision=$JARVIS_SOURCE_COMMIT

FROM application AS release-controller
USER root
COPY --from=docker:20.10.24-cli /usr/local/bin/docker /usr/local/bin/docker
CMD ["./node_modules/.bin/tsx", "apps/release-controller/main.ts"]

FROM application AS runtime
