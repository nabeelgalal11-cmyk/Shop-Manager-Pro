import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
const pino = pinoHttp.default || pinoHttp;
import path from "path";
import { fileURLToPath } from "url";

import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { sessionMiddleware, attachUser } from "./lib/auth.js";
import { seedDefaultPermissions, bootstrapAdmin } from "./lib/permissions.js";
import { stripeWebhookHandler } from "./routes/stripe-webhook.js";
import { squareWebhookHandler } from "./routes/square-webhook.js";

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

// Trust the first proxy hop (Render, Replit, Heroku, etc.) so secure cookies
// and req.ip work correctly behind a load balancer.
app.set("trust proxy", 1);

app.use(cors({ origin: true, credentials: true }));

// Stripe webhook needs the raw request body for signature verification — must
// be mounted BEFORE express.json() or the body will be parsed and re-stringified
// and the signature check will fail.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.post("/api/square/webhook", express.raw({ type: "application/json" }), squareWebhookHandler);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(attachUser);

// Bootstrap persistent application data only for real server processes. Tests
// seed the exact roles and fixtures they need and must not leave background
// imports running after their ephemeral HTTP server closes.
if (process.env.NODE_ENV !== "test") {
  seedDefaultPermissions().catch((err) => logger.error({ err }, "seedDefaultPermissions failed"));
  bootstrapAdmin().catch((err) => logger.error({ err }, "bootstrapAdmin failed"));
  import("./lib/email.js").then(({ seedEmailTemplates }) =>
    seedEmailTemplates().catch((err) => logger.error({ err }, "seedEmailTemplates failed")),
  );
}

// API routes
app.use("/api", router);

// Serve the frontend. Vite gives fingerprinted assets stable content hashes,
// so let mobile WebViews and browsers keep those assets without revalidating
// the entire 1.5 MB application bundle on every full-page navigation.
const frontendPath = path.join(__dirname, "../../shop-os/dist/public");

app.use(
  express.static(frontendPath, {
    setHeaders(res, filePath) {
      const fileName = path.basename(filePath);
      if (/-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(fileName)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        // Keep the shell and unhashed files fresh after a deployment.
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

// SPA fallback (for React routes like /repair-orders)
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

export default app;