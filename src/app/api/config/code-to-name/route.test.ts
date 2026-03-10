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

  it('GET returns defaults when server has no record', async () => {
    mockLoadConfig.mockResolvedValueOnce(null);
    const response = await GET(makeRequest('http://localhost/api/config/code-to-name'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual([]);
    expect(payload.version).toBeNull();
    expect(payload.updatedAt).toBeNull();
  });

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
});
