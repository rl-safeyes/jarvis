FROM node:24-bullseye
COPY infra/development/install-gh.mjs /tmp/install-gh.mjs
RUN node /tmp/install-gh.mjs && rm -rf /tmp/gh* /tmp/install-gh.mjs
COPY apps/github-bridge/ /opt/github/
RUN chmod 755 /opt/github/askpass.mjs && mkdir /state /sources && chown node:node /state /sources
USER node
WORKDIR /state
CMD ["node", "/opt/github/server.mjs"]
