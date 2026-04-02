// build.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

// Allow plugins (like esbuild-plugin-pino) to use require
globalThis.require = createRequire(import.meta.url);

// Use the current working directory (Render's Root Directory)
const artifactDir = process.cwd();

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");

  // Remove old dist folder
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
    // Externalize problematic packages that cannot be bundled
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "@prisma/client",
      "@tensorflow/*",
      "@aws-sdk/*",
      "@google-cloud/*",
      "aws-sdk",
      "electron",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      // Add more if you see runtime errors
    ],
    plugins: [
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    banner: {
      js: `
import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
      `
    }
  });

  console.log("Build completed. dist/index.mjs is ready!");
}

buildAll().catch(err => {
  console.error(err);
  process.exit(1);
});