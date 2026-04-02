# Use official Node.js LTS image
FROM node:22

# Set working directory inside the container
WORKDIR /app

# Copy lockfile and package.json from root first
COPY package.json pnpm-lock.yaml ./

# Install pnpm globally
RUN npm install -g pnpm

# Install dependencies (including workspace)
RUN pnpm install

# Copy the whole repo into container
COPY . .

# Build the api-server
RUN pnpm --filter @workspace/api-server build

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose the port
EXPOSE 8080

# Start command
CMD ["node", "artifacts/api-server/dist/index.mjs"]
