# syntax=docker/dockerfile:1

# ============================================================================
# Global Top Group – Financial Management Dashboard
#
# Three things about this app shape the image:
#
#   * better-sqlite3 ships a native binding. Next's tracing picks it up into
#     the standalone bundle, and the build asserts that it did.
#   * The Excel parser runs in workers/excel-parse.worker.mjs, a plain .mjs
#     file outside Next's build graph. Tracing therefore never sees `xlsx`,
#     so the worker's dependencies are staged in by hand.
#   * schema.sql and that worker are read from disk at runtime, not imported.
#
# The database and uploaded originals live under /data, which must be a
# mounted volume — everything else in the image is disposable.
# ============================================================================

# ---------------------------------------------------------------- build deps
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Only needed if better-sqlite3 has no prebuild for this platform; never
# reaches the runtime image.
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

# Stage the parser worker's dependency tree on its own. Taken from the `deps`
# stage so the versions are exactly what the lockfile resolved, rather than a
# fresh install that could drift.
RUN mkdir -p /worker-modules \
 && cp -r node_modules/xlsx \
          node_modules/adler-32 \
          node_modules/cfb \
          node_modules/codepage \
          node_modules/crc-32 \
          node_modules/frac \
          node_modules/ssf \
          node_modules/wmf \
          node_modules/word \
          /worker-modules/

# ------------------------------------------------------------------- runtime
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    GTG_DATA_DIR=/data

RUN mkdir -p /data && chown -R node:node /data

# The standalone bundle carries its own minimal node_modules, including the
# traced better-sqlite3 with its prebuilt bindings.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

# Read at runtime rather than imported, so neither is traced automatically.
COPY --from=build --chown=node:node /app/src/lib/db/schema.sql ./src/lib/db/schema.sql
COPY --from=build --chown=node:node /app/workers ./workers

# Invisible to tracing, because only the .mjs worker requires them.
COPY --from=build --chown=node:node /worker-modules/ ./node_modules/

# User administration and password recovery. A deployment whose only
# administrator password was lost has no way back in otherwise, since
# passwords are stored only as hashes.
COPY --from=build --chown=node:node /app/scripts/users.mjs ./scripts/users.mjs

# Prove the image actually works before it ships. Each of these has already
# been a real defect; a failure here costs seconds, whereas the same failure
# in production costs a crash-looping container or an import that dies on
# every file.
RUN node -e "require('xlsx');" \
 && node -e "const D=require('better-sqlite3'); const d=new D(':memory:'); d.prepare('SELECT 1').get(); d.close();" \
 && test -f ./src/lib/db/schema.sql \
 && test -f ./workers/excel-parse.worker.mjs \
 && echo 'image self-check passed'

USER node
EXPOSE 8080

# The database and every uploaded original live here. Without a volume the
# import history is lost on each restart.
VOLUME ["/data"]

CMD ["node", "server.js"]
