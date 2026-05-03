// artifacts/api-server/src/index.ts
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// recreate __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import dotenv from "dotenv";

// 1️⃣ Load environment variables.
//    - On Render, Secret Files mount at /etc/secrets/<filename>.
//    - Locally, fall back to a .env in the working directory.
const renderSecretEnv = "/etc/secrets/.env";
const renderSecretEnvFound = fs.existsSync(renderSecretEnv);
if (renderSecretEnvFound) {
  dotenv.config({ path: renderSecretEnv });
}
dotenv.config();
// Visible in Render logs so you can confirm the secret file was picked up.
// Only logs presence (true/false), never values.
console.log(
  `[boot] secret file ${renderSecretEnv}: ${renderSecretEnvFound ? "FOUND" : "missing"}; ` +
    `HOSTGATOR_STORAGE_TOKEN: ${process.env.HOSTGATOR_STORAGE_TOKEN ? "set" : "MISSING"}; ` +
    `HOSTGATOR_PUBLIC_BASE_URL: ${process.env.HOSTGATOR_PUBLIC_BASE_URL ? "set" : "MISSING"}`,
);
if (!renderSecretEnvFound) {
  // Help users find their actual mount path on first boot.
  try {
    const dir = "/etc/secrets";
    if (fs.existsSync(dir)) {
      console.log(`[boot] /etc/secrets contents: ${fs.readdirSync(dir).join(", ") || "(empty)"}`);
    }
  } catch {
    // ignore
  }
}
// 2️⃣ Import your app and logger
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { seedNjmvcTemplate } from "./routes/njmvc.js";

// 3️⃣ Get the PORT from environment variables (fallback to 3000)
const rawPort = process.env.PORT || "3000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// 4️⃣ Start the server — seed NJMVC template on first run
seedNjmvcTemplate().catch(err => console.error("[NJMVC] Seed error:", err));

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});