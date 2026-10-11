FROM node:24-bullseye-slim
COPY infra/harness/runtime.mjs infra/harness/request.mjs /runtime/
COPY tests/fixtures/codex.mjs /usr/local/bin/codex
RUN chmod 755 /usr/local/bin/codex
RUN mkdir /workspace && chown node:node /workspace
USER node
WORKDIR /workspace
CMD ["node","/runtime/runtime.mjs"]
