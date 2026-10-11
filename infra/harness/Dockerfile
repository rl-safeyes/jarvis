FROM node:24-bullseye-slim
# Export the Mozilla CA bundle shipped by Node for native harness HTTPS clients.
# The slim image has no system trust store; do not disable TLS verification.
RUN node -e "const fs = require('node:fs'); fs.mkdirSync('/etc/ssl/certs', {recursive:true}); fs.writeFileSync('/etc/ssl/certs/ca-certificates.crt', require('node:tls').rootCertificates.join('\\n') + '\\n')"
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ARG HARNESS_PACKAGE=@openai/codex@0.161.0
RUN npm install -g "${HARNESS_PACKAGE}" && npm cache clean --force
WORKDIR /runtime
COPY runtime.mjs request.mjs ./
RUN mkdir /workspace && chown node:node /workspace
USER node
WORKDIR /workspace
CMD ["node", "/runtime/runtime.mjs"]
