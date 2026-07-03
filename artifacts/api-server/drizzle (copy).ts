import { defineConfig } from "drizzle-kit";

const neonUrl = process.env.NEON_DATABASE_URL;

if (!neonUrl) {
  throw new Error("NEON_DATABASE_URL is missing");
}

export default defineConfig({
  schema: "../../lib/db/src/schema/index.ts",

  dialect: "postgresql",

  dbCredentials: {
    url: neonUrl,
  },
});