FROM node:24-bullseye
COPY infra/development/install-gh.mjs /tmp/install-gh.mjs
RUN node /tmp/install-gh.mjs && rm -rf /tmp/gh* /tmp/install-gh.mjs
WORKDIR /opt/reference
COPY . .
RUN npm ci --ignore-scripts && mkdir /workspace /artifact && chown node:node /workspace /artifact
COPY infra/development/operation.mjs /opt/tools/operation.mjs
ENV HOME=/tmp/home GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/tools/operation.mjs"]
