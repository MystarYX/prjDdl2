/** @jest-environment node */

describe('config-store', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.CONFIG_DB_PROVIDER;
    delete process.env.DB_PROVIDER;
  });

  it('retries table initialization after a transient ensure failure', async () => {
    process.env.CONFIG_DB_PROVIDER = 'postgres';

    const poolQuery = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient init failure'))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ json_value: '[]', row_version: '3', updated_at: '2026-01-01T00:00:00.000Z' }],
      });

    jest.doMock('@/lib/postgres', () => ({
      getPostgresPool: jest.fn(() => ({ query: poolQuery })),
    }));
    jest.doMock('@/lib/sqlserver', () => ({
      getSqlServerPool: jest.fn(),
      sql: {},
    }));

    const store = await import('@/lib/config-store');

    await expect(store.loadConfig('rules', 'global')).rejects.toThrow('transient init failure');
    const record = await store.loadConfig('rules', 'global');

    expect(record).toEqual({
      json: '[]',
      version: '3',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(poolQuery).toHaveBeenCalledTimes(3);
  });

  it('throws VersionConflictError for postgres optimistic lock mismatch', async () => {
    process.env.CONFIG_DB_PROVIDER = 'postgres';

    const poolQuery = jest.fn().mockResolvedValue({ rows: [] });
    const clientQuery = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{ row_version: '1' }] })
      .mockResolvedValueOnce({});
    const release = jest.fn();

    jest.doMock('@/lib/postgres', () => ({
      getPostgresPool: jest.fn(() => ({
        query: poolQuery,
        connect: jest.fn().mockResolvedValue({
          query: clientQuery,
          release,
        }),
      })),
    }));
    jest.doMock('@/lib/sqlserver', () => ({
      getSqlServerPool: jest.fn(),
      sql: {},
    }));

    const store = await import('@/lib/config-store');

    await expect(
      store.saveConfig({
        kind: 'rules',
        scopeKey: 'global',
        jsonValue: '[]',
        expectedVersion: '2',
      }),
    ).rejects.toBeInstanceOf(store.VersionConflictError);

    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalled();
  });
});
