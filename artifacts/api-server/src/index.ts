// artifacts/api-server/src/index.ts
import path from "path";
import { fileURLToPath } from "url";

// recreate __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import dotenv from "dotenv";

// 1️⃣ Load environment variables from .env in api-server
dotenv.config();
// 2️⃣ Import your app and logger
import app from "./app.js";
import { logger } from "./lib/logger.js";

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