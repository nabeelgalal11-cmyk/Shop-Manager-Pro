# syntax=docker/dockerfile:1

# Base image
ARG NODE_VERSION=22.21.1
FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Build stage
FROM base AS build

# Install build tools
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 curl

# Install pnpm globally
RUN curl -fsSL https://get.pnpm.io/install.sh | sh -
ENV PATH="/root/.local/share/pnpm:$PATH"

# Copy package files
COPY artifacts/api-server/package.json artifacts/api-server/pnpm-lock.yaml ./

# Install dependencies with pnpm
RUN pnpm install --frozen-lockfile

# Copy all source code
COPY artifacts/api-server ./

# Build the project
RUN pnpm run build

# Final image
FROM base
WORKDIR /app

# The production login-triggered backup runs pg_dump in this service process.
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ca-certificates curl gnupg && \
    install -d /usr/share/postgresql-common/pgdg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg && \
    . /etc/os-release && \
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update -qq && \
    apt-get install --no-install-recommends -y postgresql-client-16 && \
    rm -rf /var/lib/apt/lists/*

# Copy built artifacts
COPY --from=build /app /app

EXPOSE 3000
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
