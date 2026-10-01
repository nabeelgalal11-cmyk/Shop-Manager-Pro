export interface DevelopmentBackupTarget {
  host: string;
  database: string;
}

export interface ResolvedDevelopmentBackupTarget {
  target: DevelopmentBackupTarget;
  connectionString: string;
}

function parsePostgresTarget(connectionString: string, variableName: string): DevelopmentBackupTarget {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL.`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${variableName} must use PostgreSQL.`);
  }

  let database: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error(`${variableName} has an invalid database name.`);
  }
  const host = url.hostname.toLowerCase();
  if (!host || !database) {
    throw new Error(`${variableName} must include a database host and name.`);
  }

  return { host, database };
}

export function resolveDevelopmentBackupTarget(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedDevelopmentBackupTarget {
  if (
    env.NODE_ENV !== "development" ||
    env.RENDER === "true" ||
    Boolean(env.RENDER_SERVICE_ID)
  ) {
    throw new Error("Manual database backups and restores are available only in the non-Render development workspace.");
  }

  const connectionString = env.DEVELOPMENT_RESTORE_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("Configure DEVELOPMENT_RESTORE_DATABASE_URL with a separate endpoint reserved for restore testing.");
  }
  const target = parsePostgresTarget(connectionString, "DEVELOPMENT_RESTORE_DATABASE_URL");
  if (target.host === "render.com" || target.host.endsWith(".render.com")) {
    throw new Error("A Render database cannot be used as a development restore target.");
  }

  const applicationConnectionString = env.DATABASE_URL?.trim();
  if (!applicationConnectionString) {
    throw new Error("The application database target could not be verified.");
  }
  const applicationTarget = parsePostgresTarget(applicationConnectionString, "DATABASE_URL");
  if (target.host === applicationTarget.host) {
    throw new Error("The restore target must use a separate test host or Neon branch from the application's primary database.");
  }

  const expectedTarget = `${target.host}/${target.database}`;
  const approvedTarget = env.DEVELOPMENT_RESTORE_TARGET?.trim();
  if (!approvedTarget) {
    throw new Error(`Set DEVELOPMENT_RESTORE_TARGET to the exact approved target: ${expectedTarget}`);
  }
  if (approvedTarget !== expectedTarget) {
    throw new Error("DEVELOPMENT_RESTORE_TARGET does not match the configured restore endpoint.");
  }

  return { target, connectionString };
}