import { getPostgresPool } from '@/lib/postgres';
import { getSqlServerPool, sql } from '@/lib/sqlserver';

type StoreKind = 'rules' | 'codeToName';
type DbProvider = 'sqlserver' | 'postgres';

interface StoreMeta {
  tableName: string;
  jsonColumn: string;
}

interface SqlServerRawRow {
  json_value: string;
  row_version: Buffer;
  updated_at: Date;
}

interface PostgresRawRow {
  json_value: string;
  row_version: string;
  updated_at: Date | string;
}

export interface StoredConfigRecord {
  json: string;
  version: string;
  updatedAt: string;
}

export class VersionConflictError extends Error {
  constructor(message = 'CONFIG_VERSION_CONFLICT') {
    super(message);
    this.name = 'VersionConflictError';
  }
}

const STORE_META: Record<StoreKind, StoreMeta> = {
  rules: {
    tableName: 'app_rule_config',
    jsonColumn: 'rules_json',
  },
  codeToName: {
    tableName: 'app_code_to_name_config',
    jsonColumn: 'config_json',
  },
};

let ensureTablesPromise: Promise<void> | null = null;
let ensuredProvider: DbProvider | null = null;

function getMeta(kind: StoreKind): StoreMeta {
  return STORE_META[kind];
}

function detectDbProvider(): DbProvider {
  const configured = (process.env.CONFIG_DB_PROVIDER || process.env.DB_PROVIDER || '').trim().toLowerCase();
  if (configured === 'postgres' || configured === 'postgresql' || configured === 'pg') {
    return 'postgres';
  }
  if (configured === 'sqlserver' || configured === 'mssql') {
    return 'sqlserver';
  }

  const hasSqlServerEnv = Boolean(
    process.env.SQLSERVER_HOST &&
      process.env.SQLSERVER_DB &&
      process.env.SQLSERVER_USER &&
      process.env.SQLSERVER_PASSWORD,
  );
  const hasPostgresEnv = Boolean((process.env.POSTGRES_URL || process.env.DATABASE_URL || '').trim());

  if (hasPostgresEnv && !hasSqlServerEnv) {
    return 'postgres';
  }
  return 'sqlserver';
}

function encodeSqlServerVersion(rowVersion: Buffer): string {
  return rowVersion.toString('hex');
}

function decodeSqlServerVersion(version: string | null | undefined): Buffer | null {
  if (!version) return null;
  try {
    const buffer = Buffer.from(version, 'hex');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function normalizeDateToIso(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function mapSqlServerRow(row: SqlServerRawRow): StoredConfigRecord {
  return {
    json: row.json_value,
    version: encodeSqlServerVersion(row.row_version),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapPostgresRow(row: PostgresRawRow): StoredConfigRecord {
  return {
    json: row.json_value,
    version: String(row.row_version),
    updatedAt: normalizeDateToIso(row.updated_at),
  };
}

async function ensureSqlServerTables(): Promise<void> {
  const pool = await getSqlServerPool();
  await pool.request().batch(`
IF OBJECT_ID(N'dbo.app_rule_config', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_rule_config (
    scope_key NVARCHAR(100) NOT NULL PRIMARY KEY,
    rules_json NVARCHAR(MAX) NOT NULL,
    row_version ROWVERSION NOT NULL,
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_app_rule_config_updated_at DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(100) NOT NULL CONSTRAINT DF_app_rule_config_updated_by DEFAULT N'system',
    CONSTRAINT CK_app_rule_config_rules_json_isjson CHECK (ISJSON(rules_json) = 1)
  );
END;

IF OBJECT_ID(N'dbo.app_code_to_name_config', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_code_to_name_config (
    scope_key NVARCHAR(100) NOT NULL PRIMARY KEY,
    config_json NVARCHAR(MAX) NOT NULL,
    row_version ROWVERSION NOT NULL,
    updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_app_code_to_name_config_updated_at DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(100) NOT NULL CONSTRAINT DF_app_code_to_name_config_updated_by DEFAULT N'system',
    CONSTRAINT CK_app_code_to_name_config_json_isjson CHECK (ISJSON(config_json) = 1)
  );
END;
  `);
}

async function ensurePostgresTables(): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(`
CREATE TABLE IF NOT EXISTS public.app_rule_config (
  scope_key VARCHAR(100) PRIMARY KEY,
  rules_json JSONB NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(100) NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS public.app_code_to_name_config (
  scope_key VARCHAR(100) PRIMARY KEY,
  config_json JSONB NOT NULL,
  row_version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(100) NOT NULL DEFAULT 'system'
);

CREATE OR REPLACE FUNCTION public.set_config_audit_fields()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  NEW.row_version := COALESCE(OLD.row_version, 0) + 1;
  NEW.updated_by := COALESCE(NEW.updated_by, OLD.updated_by, 'system');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_app_rule_config_audit'
  ) THEN
    CREATE TRIGGER trg_app_rule_config_audit
    BEFORE UPDATE ON public.app_rule_config
    FOR EACH ROW
    EXECUTE FUNCTION public.set_config_audit_fields();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_app_code_to_name_config_audit'
  ) THEN
    CREATE TRIGGER trg_app_code_to_name_config_audit
    BEFORE UPDATE ON public.app_code_to_name_config
    FOR EACH ROW
    EXECUTE FUNCTION public.set_config_audit_fields();
  END IF;
END $$;
  `);
}

export async function ensureConfigTables(): Promise<void> {
  const provider = detectDbProvider();

  if (!ensureTablesPromise || ensuredProvider !== provider) {
    ensuredProvider = provider;
    ensureTablesPromise = (async () => {
      if (provider === 'postgres') {
        await ensurePostgresTables();
      } else {
        await ensureSqlServerTables();
      }
    })().catch((error) => {
      ensureTablesPromise = null;
      throw error;
    });
  }

  return ensureTablesPromise;
}

export async function loadConfig(kind: StoreKind, scopeKey: string): Promise<StoredConfigRecord | null> {
  await ensureConfigTables();
  const meta = getMeta(kind);
  const provider = detectDbProvider();

  if (provider === 'postgres') {
    const pool = getPostgresPool();
    const result = await pool.query<PostgresRawRow>(
      `SELECT ${meta.jsonColumn}::text AS json_value, row_version::text AS row_version, updated_at
       FROM public.${meta.tableName}
       WHERE scope_key = $1`,
      [scopeKey],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapPostgresRow(result.rows[0]);
  }

  const pool = await getSqlServerPool();
  const result = await pool
    .request()
    .input('scopeKey', sql.NVarChar(100), scopeKey)
    .query<SqlServerRawRow>(`
SELECT ${meta.jsonColumn} AS json_value, row_version, updated_at
FROM dbo.${meta.tableName}
WHERE scope_key = @scopeKey
    `);

  if (result.recordset.length === 0) {
    return null;
  }

  return mapSqlServerRow(result.recordset[0]);
}

async function saveConfigSqlServer(params: {
  meta: StoreMeta;
  scopeKey: string;
  jsonValue: string;
  expectedVersion?: string | null;
  updatedBy: string;
}): Promise<StoredConfigRecord> {
  const { meta, scopeKey, jsonValue, expectedVersion = null, updatedBy } = params;
  const expectedVersionBuffer = decodeSqlServerVersion(expectedVersion);
  if (expectedVersion && !expectedVersionBuffer) {
    throw new Error('Invalid version format');
  }

  const pool = await getSqlServerPool();
  try {
    const result = await pool
      .request()
      .input('scopeKey', sql.NVarChar(100), scopeKey)
      .input('jsonValue', sql.NVarChar(sql.MAX), jsonValue)
      .input('updatedBy', sql.NVarChar(100), updatedBy)
      .input('expectedVersion', sql.VarBinary(8), expectedVersionBuffer)
      .query<SqlServerRawRow>(`
IF ISJSON(@jsonValue) <> 1
BEGIN
  THROW 50002, 'INVALID_JSON_PAYLOAD', 1;
END;

DECLARE @currentVersion VARBINARY(8);
SELECT @currentVersion = row_version
FROM dbo.${meta.tableName} WITH (UPDLOCK, HOLDLOCK)
WHERE scope_key = @scopeKey;

IF (@expectedVersion IS NOT NULL)
BEGIN
  IF (@currentVersion IS NULL OR @currentVersion <> @expectedVersion)
  BEGIN
    THROW 50001, 'CONFIG_VERSION_CONFLICT', 1;
  END;
END;

IF @currentVersion IS NULL
BEGIN
  INSERT INTO dbo.${meta.tableName}(scope_key, ${meta.jsonColumn}, updated_at, updated_by)
  VALUES(@scopeKey, @jsonValue, SYSUTCDATETIME(), @updatedBy);
END
ELSE
BEGIN
  UPDATE dbo.${meta.tableName}
  SET ${meta.jsonColumn} = @jsonValue,
      updated_at = SYSUTCDATETIME(),
      updated_by = @updatedBy
  WHERE scope_key = @scopeKey;
END;

SELECT ${meta.jsonColumn} AS json_value, row_version, updated_at
FROM dbo.${meta.tableName}
WHERE scope_key = @scopeKey;
      `);

    if (result.recordset.length === 0) {
      throw new Error('Config save failed');
    }

    return mapSqlServerRow(result.recordset[0]);
  } catch (error) {
    const requestError = error as { number?: number; message?: string };
    if (
      requestError?.number === 50001 ||
      String(requestError?.message || '').includes('CONFIG_VERSION_CONFLICT')
    ) {
      throw new VersionConflictError();
    }
    throw error;
  }
}

async function saveConfigPostgres(params: {
  meta: StoreMeta;
  scopeKey: string;
  jsonValue: string;
  expectedVersion?: string | null;
  updatedBy: string;
}): Promise<StoredConfigRecord> {
  const { meta, scopeKey, jsonValue, expectedVersion = null, updatedBy } = params;
  if (expectedVersion && !/^\d+$/.test(expectedVersion)) {
    throw new Error('Invalid version format');
  }

  let normalizedJsonValue = jsonValue;
  try {
    normalizedJsonValue = JSON.stringify(JSON.parse(jsonValue));
  } catch {
    throw new Error('INVALID_JSON_PAYLOAD');
  }

  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<{ row_version: string }>(
      `SELECT row_version::text AS row_version
       FROM public.${meta.tableName}
       WHERE scope_key = $1
       FOR UPDATE`,
      [scopeKey],
    );
    const currentVersion = current.rows[0]?.row_version ?? null;

    if (expectedVersion !== null && expectedVersion !== undefined) {
      if (!currentVersion || currentVersion !== expectedVersion) {
        throw new VersionConflictError();
      }
    }

    if (!currentVersion) {
      await client.query(
        `INSERT INTO public.${meta.tableName}
           (scope_key, ${meta.jsonColumn}, updated_at, updated_by, row_version)
         VALUES ($1, $2::jsonb, NOW(), $3, 1)`,
        [scopeKey, normalizedJsonValue, updatedBy],
      );
    } else {
      await client.query(
        `UPDATE public.${meta.tableName}
         SET ${meta.jsonColumn} = $2::jsonb,
             updated_at = NOW(),
             updated_by = $3,
             row_version = row_version + 1
         WHERE scope_key = $1`,
        [scopeKey, normalizedJsonValue, updatedBy],
      );
    }

    const result = await client.query<PostgresRawRow>(
      `SELECT ${meta.jsonColumn}::text AS json_value, row_version::text AS row_version, updated_at
       FROM public.${meta.tableName}
       WHERE scope_key = $1`,
      [scopeKey],
    );

    if (result.rows.length === 0) {
      throw new Error('Config save failed');
    }

    await client.query('COMMIT');
    return mapPostgresRow(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    if (error instanceof VersionConflictError) {
      throw error;
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function saveConfig(params: {
  kind: StoreKind;
  scopeKey: string;
  jsonValue: string;
  expectedVersion?: string | null;
  updatedBy?: string;
}): Promise<StoredConfigRecord> {
  const { kind, scopeKey, jsonValue, expectedVersion = null, updatedBy = 'web' } = params;
  await ensureConfigTables();

  const meta = getMeta(kind);
  const provider = detectDbProvider();
  if (provider === 'postgres') {
    return saveConfigPostgres({
      meta,
      scopeKey,
      jsonValue,
      expectedVersion,
      updatedBy,
    });
  }

  return saveConfigSqlServer({
    meta,
    scopeKey,
    jsonValue,
    expectedVersion,
    updatedBy,
  });
}
