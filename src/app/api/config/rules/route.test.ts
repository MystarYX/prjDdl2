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

  it('GET returns defaults when server has no record', async () => {
    mockLoadConfig.mockResolvedValueOnce(null);
    const response = await GET(makeRequest('http://localhost/api/config/rules'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.version).toBeNull();
    expect(payload.updatedAt).toBeNull();
  });

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

  it('GET returns 500 on unexpected store error', async () => {
    mockLoadConfig.mockRejectedValueOnce(new Error('boom'));
    const response = await GET(makeRequest('http://localhost/api/config/rules'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toContain('boom');
  });
});
