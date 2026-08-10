FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
# Open-core: EDITION=ce strips the Enterprise panels (their code never ships in a
# Community build); EDITION=ee (default) keeps the full ee/ overlay.
ARG EDITION=ee
RUN if [ "$EDITION" = "ce" ]; then \
      rm -f app/ee/BrandingPanel.tsx app/ee/SsoPanel.tsx app/ee/AuditExportPanel.tsx app/ee/OrgTemplatePanel.tsx && \
      printf 'import type { FC } from "react";\nexport const EE_SETTINGS_PANELS: FC[] = [];\n' > app/ee/panels.tsx && \
      echo "CE build: stripped Enterprise panels"; \
    fi
# NEXT_PUBLIC_* is inlined into the client bundle at build time. Empty default =
# same-origin (browser calls /api on whatever host served the page — the prod
# reverse-proxy setup). For plain local docker, pass http://localhost:8080.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# URL of the worker's noVNC desktop (bound to localhost:6080 by default; on a
# remote server reach it through an SSH tunnel to the same port).
ARG NEXT_PUBLIC_VNC_URL="http://localhost:6080/vnc.html?autoconnect=1&resize=scale"
ENV NEXT_PUBLIC_VNC_URL=$NEXT_PUBLIC_VNC_URL
# Optional: vendor checkout URL for the "Upgrade to Enterprise" button in About.
# Empty = button hidden (open-core / self-hosted). Set to your checkout page in the commercial build.
ARG NEXT_PUBLIC_CHECKOUT_URL=""
ENV NEXT_PUBLIC_CHECKOUT_URL=$NEXT_PUBLIC_CHECKOUT_URL
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
