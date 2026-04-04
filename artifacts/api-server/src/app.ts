import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ✅ Root route (ADD THIS)
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "API is running 🚀",
    routes: {
      health: "/api/health",
      dashboard: "/api/dashboard"
    }
  });
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
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

// ✅ API routes
app.use("/api", router);

export default app;