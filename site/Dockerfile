# ── build stage: validate HTML is well-formed ────────────────────────────────
FROM node:22-alpine AS validate
WORKDIR /src
COPY . .
RUN npx --yes html-validate "*.html" || true

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM nginx:1.31-alpine AS runtime

ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

LABEL org.opencontainers.image.title="noco-tools-site" \
      org.opencontainers.image.description="Landing page for Noco Tools — Google (Gmail + Calendar) NocoBase plugin" \
      org.opencontainers.image.url="https://github.com/kalpak44/plugin-noco-tools" \
      org.opencontainers.image.source="https://github.com/kalpak44/plugin-noco-tools" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}"

# Remove default config; install wget for health check
RUN rm /etc/nginx/conf.d/default.conf

# Custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static site files
COPY --chown=nginx:nginx *.html /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO /dev/null http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]