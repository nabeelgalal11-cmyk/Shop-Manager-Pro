// artifacts/api-server/src/index.ts

import dotenv from "dotenv";
import path from "path";

// 1️⃣ Load environment variables from .env in api-server
dotenv.config({ path: path.resolve(__dirname, "../../artifacts/api-server/.env") });

// 2️⃣ Import your app and logger
import app from "./app";
import { logger } from "./lib/logger";

// 3️⃣ Get the PORT from environment variables (fallback to 3000)
const rawPort = process.env.PORT || "3000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// 4️⃣ Start the server
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});