FROM node:24-bullseye-slim
COPY --from=docker:20.10.24-cli /usr/local/bin/docker /usr/local/bin/docker
COPY apps/runner-supervisor/server.mjs /opt/supervisor.mjs
COPY infra/harness/ /opt/recipes/
CMD ["node", "/opt/supervisor.mjs"]
