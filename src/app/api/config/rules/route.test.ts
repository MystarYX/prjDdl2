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

describe('/api/config/rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========== GET ==========

  it('GET returns defaults when server has no record', async () => {
    mockLoadConfig.mockResolvedValueOnce(null);
    const response = await GET(makeRequest('http://localhost/api/config/rules'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.version).toBeNull();
    expect(payload.updatedAt).toBeNull();
  });

  it('GET returns 500 on unexpected store error', async () => {
    mockLoadConfig.mockRejectedValueOnce(new Error('boom'));
    const response = await GET(makeRequest('http://localhost/api/config/rules'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toContain('boom');
  });

  it('GET returns saved rules when record exists', async () => {
    const mockRules = [
      { id: '1', keywords: ['test'], matchType: 'contains', targetField: 'name', targetDatabases: ['spark'], dataTypes: { spark: 'STRING' }, typeParams: {}, priority: 1 },
    ];
    mockLoadConfig.mockResolvedValueOnce({
      json: JSON.stringify(mockRules),
      version: 'v2',
      updatedAt: '2026-06-30T10:00:00Z',
      scopeKey: 'global',
    });
    const response = await GET(makeRequest('http://localhost/api/config/rules'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual(mockRules);
    expect(payload.version).toBe('v2');
    expect(payload.updatedAt).toBe('2026-06-30T10:00:00Z');
  });

  it('GET respects scopeKey query parameter', async () => {
    mockLoadConfig.mockResolvedValueOnce(null);
    await GET(makeRequest('http://localhost/api/config/rules?scopeKey=custom_scope'));

    expect(mockLoadConfig).toHaveBeenCalledWith('rules', 'custom_scope');
  });

  it('GET returns defaults when stored JSON is malformed', async () => {
    mockLoadConfig.mockResolvedValueOnce({
      json: '{invalid json',
      version: 'v1',
      updatedAt: null,
      scopeKey: 'global',
    });
    const response = await GET(makeRequest('http://localhost/api/config/rules'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(payload.data)).toBe(true);
  });

  it('GET returns defaults when stored JSON is not an array', async () => {
    mockLoadConfig.mockResolvedValueOnce({
      json: '{"key": "value"}',
      version: 'v1',
      updatedAt: null,
      scopeKey: 'global',
    });
    const response = await GET(makeRequest('http://localhost/api/config/rules'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(payload.data)).toBe(true);
  });

  // ========== PUT ==========

  it('PUT returns 400 when data payload is invalid', async () => {
    const response = await PUT(
      makeRequest('http://localhost/api/config/rules', {
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
      makeRequest('http://localhost/api/config/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'not-an-array' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Invalid data payload');
  });

  it('PUT returns 409 on version conflict', async () => {
    mockSaveConfig.mockRejectedValueOnce(new VersionConflictError());
    const response = await PUT(
      makeRequest('http://localhost/api/config/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [], version: 'bad-version' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain('updated by another user');
  });

  it('PUT returns 500 on unexpected store error', async () => {
    mockSaveConfig.mockRejectedValueOnce(new Error('store failure'));
    const response = await PUT(
      makeRequest('http://localhost/api/config/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [] }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toContain('store failure');
  });

  it('PUT successfully saves rules with valid data', async () => {
    const rulesData = [
      { id: 'r1', keywords: ['amount'], matchType: 'contains', targetField: 'name', targetDatabases: ['spark'], dataTypes: { spark: 'DECIMAL' }, typeParams: { spark: { precision: 18, scale: 2 } }, priority: 1 },
    ];
    mockSaveConfig.mockResolvedValueOnce({
      version: 'v3',
      updatedAt: '2026-06-30T12:00:00Z',
    });
    const response = await PUT(
      makeRequest('http://localhost/api/config/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: rulesData, version: 'v2', updatedBy: 'tester' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual(rulesData);
    expect(payload.version).toBe('v3');
    expect(payload.updatedAt).toBe('2026-06-30T12:00:00Z');
  });

  it('PUT passes scopeKey from request body', async () => {
    const rulesData: any[] = [];
    mockSaveConfig.mockResolvedValueOnce({ version: 'v1', updatedAt: null });
    await PUT(
      makeRequest('http://localhost/api/config/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: rulesData, scopeKey: 'my_scope' }),
      }),
    );

    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ scopeKey: 'my_scope' }),
    );
  });

  it('PUT accepts scope_key (underscore) as alias', async () => {
    const rulesData: any[] = [];
    mockSaveConfig.mockResolvedValueOnce({ version: 'v1', updatedAt: null });
    await PUT(
      makeRequest('http://localhost/api/config/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: rulesData, scope_key: 'underscore_scope' }),
      }),
    );

    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ scopeKey: 'underscore_scope' }),
    );
  });
});
