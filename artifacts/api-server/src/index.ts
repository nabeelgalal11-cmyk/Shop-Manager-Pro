// artifacts/api-server/src/index.ts

import dotenv from "dotenv";
import path from "path";

// Load environment variables from the same folder as the API server
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];
if (!rawPort) {
  throw new Error("Error: PORT environment variable is required but not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});