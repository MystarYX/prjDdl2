import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_CODE_TO_NAME_CONFIG,
  DEFAULT_CODE_TO_NAME_SCOPE_KEY,
  type CodeToNameConfigRow,
} from '@/lib/config-defaults';
import { loadConfig, saveConfig, VersionConflictError } from '@/lib/config-store';

export const dynamic = 'force-dynamic';

interface CodeToNamePayload {
  scopeKey?: string;
  scope_key?: string;
  version?: string | null;
  updatedBy?: string;
  data?: CodeToNameConfigRow[];
}

function parseScopeKey(request: NextRequest, body?: CodeToNamePayload): string {
  return (
    body?.scopeKey ||
    body?.scope_key ||
    request.nextUrl.searchParams.get('scopeKey') ||
    request.nextUrl.searchParams.get('scope_key') ||
    DEFAULT_CODE_TO_NAME_SCOPE_KEY
  );
}

function safeParseConfig(json: string | null): CodeToNameConfigRow[] {
  if (!json) return DEFAULT_CODE_TO_NAME_CONFIG;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : DEFAULT_CODE_TO_NAME_CONFIG;
  } catch {
    return DEFAULT_CODE_TO_NAME_CONFIG;
  }
}

export async function GET(request: NextRequest) {
  try {
    const scopeKey = parseScopeKey(request);
    const record = await loadConfig('codeToName', scopeKey);

    if (!record) {
      return NextResponse.json({
        data: DEFAULT_CODE_TO_NAME_CONFIG,
        version: null,
        updatedAt: null,
      });
    }

    return NextResponse.json({
      data: safeParseConfig(record.json),
      version: record.version,
      updatedAt: record.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load code-to-name config' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as CodeToNamePayload;
    const scopeKey = parseScopeKey(request, body);
    const data = body?.data;

    if (!Array.isArray(data)) {
      return NextResponse.json({ error: 'Invalid data payload' }, { status: 400 });
    }

    const record = await saveConfig({
      kind: 'codeToName',
      scopeKey,
      jsonValue: JSON.stringify(data),
      expectedVersion: typeof body.version === 'string' ? body.version : null,
      updatedBy: body.updatedBy || 'web',
    });

    return NextResponse.json({
      data,
      version: record.version,
      updatedAt: record.updatedAt,
    });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return NextResponse.json(
        { error: 'Code-to-name config was updated by another user, please refresh and retry.' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save code-to-name config' },
      { status: 500 },
    );
  }
}
