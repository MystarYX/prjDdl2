/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/config-store', () => {
  class VersionConflictError extends Error {
    constructor(message = 'CONFIG_VERSION_CONFLICT') {
      super(message);
      this.name = 'VersionConflictError';
    }
  }

  return {
    loadConfig: jest.fn(),
    saveConfig: jest.fn(),
    VersionConflictError,
  };
});

import { GET, PUT } from './route';
import { loadConfig, saveConfig, VersionConflictError } from '@/lib/config-store';

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;
const mockSaveConfig = saveConfig as jest.MockedFunction<typeof saveConfig>;

function makeRequest(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

describe('/api/config/code-to-name', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== GET ==========

  it('GET returns defaults when server has no record', async () => {
    mockLoadConfig.mockResolvedValueOnce(null);
    const response = await GET(makeRequest('http://localhost/api/config/code-to-name'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual([]);
    expect(payload.version).toBeNull();
    expect(payload.updatedAt).toBeNull();
  });

  it('GET returns saved config when record exists', async () => {
    const mockConfig = [
      { id: 'c1', tableEnName: 'dim_dept', tableChineseName: '部门维表', tableAlias: 'd', dimTableField: 'dept_id', mainTableField: 'dept_id', extraConditions: '', requireFields: 'dept_name' },
    ];
    mockLoadConfig.mockResolvedValueOnce({
      json: JSON.stringify(mockConfig),
      version: 'v5',
      updatedAt: '2026-06-30T08:00:00Z',
      scopeKey: 'global',
    });
    const response = await GET(makeRequest('http://localhost/api/config/code-to-name'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual(mockConfig);
    expect(payload.version).toBe('v5');
  });

  it('GET respects scopeKey query parameter', async () => {
    mockLoadConfig.mockResolvedValueOnce(null);
    await GET(makeRequest('http://localhost/api/config/code-to-name?scopeKey=custom_scope'));

    expect(mockLoadConfig).toHaveBeenCalledWith('codeToName', 'custom_scope');
  });

  it('GET returns defaults when stored JSON is malformed', async () => {
    mockLoadConfig.mockResolvedValueOnce({
      json: 'not json at all',
      version: 'v1',
      updatedAt: null,
      scopeKey: 'global',
    });
    const response = await GET(makeRequest('http://localhost/api/config/code-to-name'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual([]);
  });

  it('GET returns defaults when stored JSON is not an array', async () => {
    mockLoadConfig.mockResolvedValueOnce({
      json: '"just a string"',
      version: 'v1',
      updatedAt: null,
      scopeKey: 'global',
    });
    const response = await GET(makeRequest('http://localhost/api/config/code-to-name'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual([]);
  });

  it('GET returns 500 on unexpected store error', async () => {
    mockLoadConfig.mockRejectedValueOnce(new Error('db connection lost'));
    const response = await GET(makeRequest('http://localhost/api/config/code-to-name'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toContain('db connection lost');
  });

  // ========== PUT ==========

  it('PUT returns 409 on version conflict', async () => {
    mockSaveConfig.mockRejectedValueOnce(new VersionConflictError());
    const response = await PUT(
      makeRequest('http://localhost/api/config/code-to-name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [], version: '1' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain('updated by another user');
  });

  it('PUT returns 500 on unexpected error', async () => {
    mockSaveConfig.mockRejectedValueOnce(new Error('save failed'));
    const response = await PUT(
      makeRequest('http://localhost/api/config/code-to-name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [] }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toContain('save failed');
  });

  it('PUT returns 400 when data payload is invalid', async () => {
    const response = await PUT(
      makeRequest('http://localhost/api/config/code-to-name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: null }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Invalid data payload');
  });

  it('PUT returns 400 when data is a string instead of array', async () => {
    const response = await PUT(
      makeRequest('http://localhost/api/config/code-to-name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'bad-data' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Invalid data payload');
  });

  it('PUT successfully saves config with valid data', async () => {
    const configData = [
      { id: 'c2', tableEnName: 'dim_user', tableChineseName: '用户维表', tableAlias: 'u', dimTableField: 'user_id', mainTableField: 'user_id', extraConditions: 'u.status = 1', requireFields: 'user_name,dept_name' },
    ];
    mockSaveConfig.mockResolvedValueOnce({
      version: 'v2',
      updatedAt: '2026-06-30T09:00:00Z',
    });
    const response = await PUT(
      makeRequest('http://localhost/api/config/code-to-name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: configData, version: 'v1', updatedBy: 'admin' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual(configData);
    expect(payload.version).toBe('v2');
    expect(payload.updatedAt).toBe('2026-06-30T09:00:00Z');
  });

  it('PUT passes scopeKey from request body', async () => {
    mockSaveConfig.mockResolvedValueOnce({ version: 'v1', updatedAt: null });
    await PUT(
      makeRequest('http://localhost/api/config/code-to-name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [], scopeKey: 'my_scope' }),
      }),
    );

    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ scopeKey: 'my_scope' }),
    );
  });

  it('PUT accepts scope_key (underscore) alias', async () => {
    mockSaveConfig.mockResolvedValueOnce({ version: 'v1', updatedAt: null });
    await PUT(
      makeRequest('http://localhost/api/config/code-to-name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [], scope_key: 'underscore_scope' }),
      }),
    );

    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ scopeKey: 'underscore_scope' }),
    );
  });
});
