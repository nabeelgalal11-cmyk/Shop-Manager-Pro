import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
const pino = pinoHttp.default || pinoHttp;
import path from "path";
import { fileURLToPath } from "url";

import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

// fix __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// middlewares
app.use(
  pino({
    logger,
    serializers: {
      req(req: any) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: any) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use("/api", router);

// 🔥 SERVE FRONTEND (shop-os)
const frontendPath = path.join(__dirname, "../../shop-os/dist/public");

app.use(express.static(frontendPath));

// SPA fallback (for React routes like /repair-orders)
app.get("/.*/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

export default app;