/** @jest-environment node */

import { NextRequest } from 'next/server';
import { POST } from './route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:5000/api/generate-ddl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/generate-ddl', () => {
  it('returns 400 for unsupported databaseTypes instead of silent success', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_id AS id FROM users',
        databaseTypes: ['postgresql'],
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Unsupported databaseTypes');
  });

  it('keeps default keyword inference when custom rules are missing', async () => {
    const response = await POST(
      makeRequest({
        sql: `
          SELECT
            order_amount AS amount, -- 订单金额
            trade_date AS trans_date, -- 交易日期
            create_time AS create_time -- 创建时间
          FROM trade_records
        `,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl || payload.ddls?.[0]?.ddl || '';

    expect(response.status).toBe(200);
    expect(ddl).toContain('amount');
    expect(ddl).toMatch(/DECIMAL\(24,\s?6\)/);
    expect(ddl).toContain('trans_date');
    expect(ddl).toContain('DATE');
    expect(ddl).toContain('create_time');
    expect(ddl).toContain('TIMESTAMP');
  });
});
