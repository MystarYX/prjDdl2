import { Pool } from 'pg';

declare global {
  var __postgresPool: Pool | undefined;
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function getConnectionString(): string {
  const value = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!value || !value.trim()) {
    throw new Error('Missing required env: POSTGRES_URL (or DATABASE_URL)');
  }
  return value.trim();
}

export function getPostgresPool(): Pool {
  if (!global.__postgresPool) {
    const connectionString = getConnectionString();
    const rejectUnauthorized = !readBooleanEnv('POSTGRES_SSL_ALLOW_SELF_SIGNED', false);

    global.__postgresPool = new Pool({
      connectionString,
      ssl: connectionString.includes('sslmode=') ? undefined : { rejectUnauthorized },
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  return global.__postgresPool;
}

export async function pingPostgres(): Promise<boolean> {
  const pool = getPostgresPool();
  await pool.query('SELECT 1 AS ok');
  return true;
}
