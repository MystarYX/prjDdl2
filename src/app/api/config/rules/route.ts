import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_GLOBAL_RULES,
  DEFAULT_RULE_SCOPE_KEY,
  type GlobalRule,
} from '@/lib/config-defaults';
import { loadConfig, saveConfig, VersionConflictError } from '@/lib/config-store';

export const dynamic = 'force-dynamic';

interface RulesPayload {
  scopeKey?: string;
  scope_key?: string;
  version?: string | null;
  updatedBy?: string;
  data?: GlobalRule[];
}

function parseScopeKey(request: NextRequest, body?: RulesPayload): string {
  return (
    body?.scopeKey ||
    body?.scope_key ||
    request.nextUrl.searchParams.get('scopeKey') ||
    request.nextUrl.searchParams.get('scope_key') ||
    DEFAULT_RULE_SCOPE_KEY
  );
}

function safeParseRules(json: string | null): GlobalRule[] {
  if (!json) return DEFAULT_GLOBAL_RULES;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : DEFAULT_GLOBAL_RULES;
  } catch {
    return DEFAULT_GLOBAL_RULES;
  }
}

export async function GET(request: NextRequest) {
  try {
    const scopeKey = parseScopeKey(request);
    const record = await loadConfig('rules', scopeKey);

    if (!record) {
      return NextResponse.json({
        data: DEFAULT_GLOBAL_RULES,
        version: null,
        updatedAt: null,
      });
    }

    return NextResponse.json({
      data: safeParseRules(record.json),
      version: record.version,
      updatedAt: record.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load rules config' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as RulesPayload;
    const scopeKey = parseScopeKey(request, body);
    const data = body?.data;

    if (!Array.isArray(data)) {
      return NextResponse.json({ error: 'Invalid data payload' }, { status: 400 });
    }

    const record = await saveConfig({
      kind: 'rules',
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
        { error: 'Rules config was updated by another user, please refresh and retry.' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save rules config' },
      { status: 500 },
    );
  }
}
