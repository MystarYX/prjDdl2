import sql from 'mssql';

declare global {
  var __sqlServerPoolPromise: Promise<sql.ConnectionPool> | undefined;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function getSqlServerConfig(): sql.config {
  const port = Number(process.env.SQLSERVER_PORT || '1433');
  if (Number.isNaN(port)) {
    throw new Error('SQLSERVER_PORT must be a valid number');
  }

  return {
    server: readRequiredEnv('SQLSERVER_HOST'),
    port,
    database: readRequiredEnv('SQLSERVER_DB'),
    user: readRequiredEnv('SQLSERVER_USER'),
    password: readRequiredEnv('SQLSERVER_PASSWORD'),
    options: {
      encrypt: readBooleanEnv('SQLSERVER_ENCRYPT', true),
      trustServerCertificate: readBooleanEnv('SQLSERVER_TRUST_SERVER_CERT', false),
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

export async function getSqlServerPool(): Promise<sql.ConnectionPool> {
  if (!global.__sqlServerPoolPromise) {
    const config = getSqlServerConfig();
    global.__sqlServerPoolPromise = new sql.ConnectionPool(config).connect();
  }

  return global.__sqlServerPoolPromise;
}

export async function ping(): Promise<boolean> {
  const pool = await getSqlServerPool();
  await pool.request().query('SELECT 1 AS ok');
  return true;
}

export { sql };
