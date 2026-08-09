FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
# Open-core: EDITION=ce removes the Enterprise overlay before compiling (the
# runtime loader then falls back to Community); EDITION=ee (default) keeps it.
ARG EDITION=ee
RUN if [ "$EDITION" = "ce" ]; then rm -rf src/ee && echo "CE build: removed src/ee"; fi
RUN npm run build

# Baked-in git commit (passed as a build arg; shown in the About dialog).
ARG GIT_COMMIT=dev
ENV AEGIS_GIT_COMMIT=$GIT_COMMIT

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
