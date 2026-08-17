# syntax=docker/dockerfile:1

# ============================================================================
# Global Top Group – Financial Management Dashboard
#
# Three things about this app shape the image:
#   * better-sqlite3 is a native module, so the build stage needs a toolchain.
#   * schema.sql and the Excel parsing worker are read from disk at runtime,
#     not imported, so they are copied in explicitly.
#   * the database and the uploaded originals live under /data, which must be
#     a mounted volume — everything else in the image is disposable.
# ============================================================================

# ---------------------------------------------------------------- build deps
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# python3/make/g++ are only needed if better-sqlite3 has no prebuild for this
# platform; they never reach the runtime image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# --------------------------------------------------------------------- build
FROM node:22-bookworm-slim AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ------------------------------------------------------------------- runtime
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    GTG_DATA_DIR=/data

# Runs unprivileged. The node image already ships a `node` user.
RUN mkdir -p /data && chown -R node:node /data

# The standalone bundle carries its own minimal node_modules.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

# Read at runtime rather than imported, so neither is traced automatically.
COPY --from=build --chown=node:node /app/src/lib/db/schema.sql ./src/lib/db/schema.sql
COPY --from=build --chown=node:node /app/workers ./workers

# better-sqlite3 is external to the bundle, so its compiled binding is copied
# wholesale rather than relying on tracing to pick up the .node file.
COPY --from=build --chown=node:node /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=build --chown=node:node /app/node_modules/bindings ./node_modules/bindings
COPY --from=build --chown=node:node /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

USER node
EXPOSE 8080

# The database and every uploaded original live here. Without a volume the
# import history is lost on each restart.
VOLUME ["/data"]

CMD ["node", "server.js"]
