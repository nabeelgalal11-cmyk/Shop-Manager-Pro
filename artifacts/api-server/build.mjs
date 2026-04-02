import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    sourcemap: "linked",
    logLevel: "info",
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "pg-native",
      "oracledb",
      "@prisma/client"
    ],
    banner: {
      js: `import { createRequire as __require } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
globalThis.require = __require(import.meta.url);
globalThis.__filename = fileURLToPath(import.meta.url);
globalThis.__dirname = path.dirname(globalThis.__filename);`
    }
  });
}

buildAll().catch(err => {
  console.error(err);
  process.exit(1);
});
