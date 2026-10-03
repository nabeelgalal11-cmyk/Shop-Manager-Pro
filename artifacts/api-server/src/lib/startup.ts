type StartupLogger = {
  error: (details: { err: unknown }, message: string) => void;
};

/**
 * Keep the listener behind startup checks so a failed schema migration never
 * leaves the service accepting requests against an incompatible database.
 */
export async function startAfterSchemaMigrations({
  runMigrations,
  start,
  logger,
  exit,
}: {
  runMigrations: () => Promise<void>;
  start: () => void;
  logger: StartupLogger;
  exit: (code: number) => void;
}) {
  try {
    await runMigrations();
    start();
  } catch (err) {
    logger.error({ err }, "Server startup aborted");
    exit(1);
  }
}