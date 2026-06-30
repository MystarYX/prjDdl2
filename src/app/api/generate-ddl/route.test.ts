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
  // ========== 基础校验 ==========

  it('returns 400 for empty sql input', async () => {
    const response = await POST(
      makeRequest({
        sql: '   ',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('请提供有效的SQL查询语句');
  });

  it('returns 400 for unparseable sql input', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('未能从SQL中解析出字段');
  });

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

  it('returns 400 when some databaseTypes are unsupported', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_id AS id FROM users',
        databaseTypes: ['spark', 'oracle'],
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Unsupported databaseTypes');
    expect(payload.error).toContain('oracle');
  });

  it('returns 400 for null sql input', async () => {
    const response = await POST(
      makeRequest({
        sql: null,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('请提供有效的SQL查询语句');
  });

  // ========== 默认关键词推断 ==========

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

  // ========== 基础 SELECT 测试 ==========

  it('parses basic SELECT with simple fields and generates Spark DDL', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_id, user_name, age FROM users',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS');
    expect(ddl).toContain('user_id');
    expect(ddl).toContain('user_name');
    expect(ddl).toContain('age');
    expect(ddl).toContain('PARTITIONED BY (pt STRING');
    expect(ddl).toContain('STORED AS ORC');
    expect(ddl).toContain('LIFECYCLE 10');
  });

  it('parses field with AS alias', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_name AS uname FROM users',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    // 字段名应该用别名
    expect(ddl).toContain('uname');
    expect(ddl).not.toContain('user_name');
  });

  it('parses field with inline comment and uses alias', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT product_id AS pid -- 产品ID\nFROM products',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('pid');
    expect(ddl).toContain('产品ID');
  });

  // ========== SELECT DISTINCT ==========

  it('parses SELECT DISTINCT correctly', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT DISTINCT category AS cat_name -- 分类名称\nFROM products',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('cat_name');
    expect(ddl).toContain('分类名称');
  });

  // ========== 聚合函数 ==========

  it('parses aggregation functions with aliases', async () => {
    const response = await POST(
      makeRequest({
        sql: `SELECT
  COUNT(*) AS total_cnt, -- 总数
  SUM(amount) AS sum_amt, -- 总金额
  AVG(price) AS avg_price -- 平均价格
FROM orders`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('total_cnt');
    expect(ddl).toContain('sum_amt');
    expect(ddl).toContain('avg_price');
    expect(ddl).toContain('总数');
    expect(ddl).toContain('总金额');
    expect(ddl).toContain('平均价格');
  });

  // ========== 表别名（t. 前缀） ==========

  it('removes table alias prefix t. from field names', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT t.user_id AS uid, t.user_name AS uname FROM users t',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('uid');
    expect(ddl).toContain('uname');
  });

  // ========== 无 FROM 的字段列表 ==========

  it('parses field list without FROM (with commas between fields)', async () => {
    const response = await POST(
      makeRequest({
        sql: 'user_id, -- 用户ID\nuser_name, -- 名称\namount -- 金额',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('user_id');
    expect(ddl).toContain('user_name');
    expect(ddl).toContain('amount');
    expect(ddl).toContain('用户ID');
    expect(ddl).toContain('名称');
    expect(ddl).toContain('金额');
  });

  // ========== 带 GROUP BY / ORDER BY / LIMIT ==========

  it('parses SELECT with GROUP BY and ORDER BY', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT dept_id AS dept_id, COUNT(*) AS cnt FROM employees GROUP BY dept_id ORDER BY cnt DESC',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('dept_id');
    expect(ddl).toContain('cnt');
  });

  it('parses SELECT with LIMIT clause', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT order_id AS oid, amount AS amt FROM orders LIMIT 10',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ddl).toContain('oid');
    expect(payload.ddl).toContain('amt');
  });

  // ========== StarRocks 输出 ==========

  it('generates StarRocks DDL with 5 audit fields', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_id AS id, user_name AS name FROM users',
        databaseTypes: ['starrocks'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('ENGINE=OLAP');
    expect(ddl).toContain('DISTRIBUTED BY HASH');
    expect(ddl).toContain('etl_time');
    expect(ddl).toContain('update_time');
    expect(ddl).toContain('sbmt_time');
    expect(ddl).toContain('dsg_opc');
    expect(ddl).toContain('db_time');
    expect(ddl).toContain('PROPERTIES');
    expect(ddl).toContain('"replication_num" = "3"');
    expect(ddl).toContain('"compression" = "LZ4"');
  });

  it('generates StarRocks DDL with VARCHAR as default type', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_name AS name FROM users',
        databaseTypes: ['starrocks'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('VARCHAR');
    expect(ddl).not.toContain('STRING');
  });

  // ========== MySQL 输出 ==========

  it('generates MySQL DDL with ENGINE and PRIMARY KEY', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_id AS id, user_name AS name FROM users',
        databaseTypes: ['mysql'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    expect(ddl).toContain('PRIMARY KEY');
    expect(ddl).toContain('VARCHAR(255)');
  });

  it('uses first field as primary key in MySQL DDL', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT order_id AS oid, amount AS amt FROM orders',
        databaseTypes: ['mysql'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(ddl).toContain('PRIMARY KEY (oid)');
  });

  // ========== 多数据库同时输出 ==========

  it('returns multiple DDLs when multiple databaseTypes specified', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_id AS id FROM users',
        databaseTypes: ['spark', 'mysql'],
      }),
    );
    const payload = await response.json();
    const ddls = payload.ddls;

    expect(response.status).toBe(200);
    expect(Array.isArray(ddls)).toBe(true);
    expect(ddls).toHaveLength(2);

    const sparkDdl = ddls.find((d: any) => d.databaseType === 'spark');
    const mysqlDdl = ddls.find((d: any) => d.databaseType === 'mysql');
    expect(sparkDdl).toBeDefined();
    expect(mysqlDdl).toBeDefined();
    expect(sparkDdl.ddl).toContain('CREATE TABLE IF NOT EXISTS');
    expect(mysqlDdl.ddl).toContain('CREATE TABLE ');
    expect(mysqlDdl.ddl).not.toContain('IF NOT EXISTS');
  });

  it('returns single ddl format when only one databaseType', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_id AS id FROM users',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();

    expect(typeof payload.ddl).toBe('string');
    expect(payload.ddls).toBeUndefined();
  });

  // ========== 默认数据库类型 ==========

  it('defaults to spark when no databaseTypes provided', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_id AS id FROM users',
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS');
  });

  // ========== CREATE TABLE 语句解析 ==========

  it('parses CREATE TABLE statement with types and comments', async () => {
    const response = await POST(
      makeRequest({
        sql: `CREATE TABLE test_table (
  id STRING COMMENT '主键ID',
  name STRING COMMENT '名称',
  amount DECIMAL(24,6) COMMENT '金额'
)`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('id');
    expect(ddl).toContain('name');
    expect(ddl).toContain('amount');
    // 原始类型保留
    expect(ddl).toContain('DECIMAL(24,6)');
  });

  it('parses CREATE TABLE IF NOT EXISTS', async () => {
    const response = await POST(
      makeRequest({
        sql: `CREATE TABLE IF NOT EXISTS my_table (
  col1 STRING COMMENT '字段1',
  col2 INT COMMENT '字段2'
)`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('col1');
    expect(ddl).toContain('col2');
  });

  // ========== 自定义规则测试 ==========

  it('applies custom rules with contains match type', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_phone AS phone, user_email AS email FROM users',
        databaseTypes: ['spark'],
        rulesByDatabase: {
          spark: [
            {
              keywords: ['phone', 'email'],
              matchType: 'contains',
              targetField: 'name',
              dataType: 'STRING',
              priority: 1,
            },
          ],
        },
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('phone');
    expect(ddl).toContain('email');
  });

  it('applies custom rules with equals match type', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT status_code AS status_code FROM orders',
        databaseTypes: ['spark'],
        rulesByDatabase: {
          spark: [
            {
              keywords: ['status_code'],
              matchType: 'equals',
              targetField: 'name',
              dataType: 'STRING',
              priority: 1,
            },
          ],
        },
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('STRING');
  });

  it('applies custom rules with prefix match type', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT create_time AS ctime, update_time AS utime FROM logs',
        databaseTypes: ['spark'],
        rulesByDatabase: {
          spark: [
            {
              keywords: ['create_', 'update_'],
              matchType: 'prefix',
              targetField: 'name',
              dataType: 'TIMESTAMP',
              priority: 1,
            },
          ],
        },
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('TIMESTAMP');
  });

  it('applies custom rules with suffix match type', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_name AS name, user_desc AS desc FROM users',
        databaseTypes: ['spark'],
        rulesByDatabase: {
          spark: [
            {
              keywords: ['_name', '_desc'],
              matchType: 'suffix',
              targetField: 'name',
              dataType: 'STRING',
              priority: 1,
            },
          ],
        },
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('name');
    expect(ddl).toContain('desc');
  });

  it('applies custom rules with regex match type', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_email AS email FROM users',
        databaseTypes: ['spark'],
        rulesByDatabase: {
          spark: [
            {
              keywords: ['^[a-z_]*email[a-z_]*$'],
              matchType: 'regex',
              targetField: 'name',
              dataType: 'STRING',
              priority: 1,
            },
          ],
        },
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('STRING');
  });

  it('respects rule priority (lower number = higher priority)', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT order_amount AS amount FROM orders',
        databaseTypes: ['spark'],
        rulesByDatabase: {
          spark: [
            {
              keywords: ['amount'],
              matchType: 'contains',
              targetField: 'name',
              dataType: 'BIGINT',
              priority: 99,
            },
            {
              keywords: ['amount'],
              matchType: 'contains',
              targetField: 'name',
              dataType: 'INT',
              priority: 1,
            },
          ],
        },
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    // 优先级 1 的 INT 应该优先于优先级 99 的 BIGINT
    expect(ddl).toContain('INT');
  });

  // ========== CASE WHEN ==========

  it('parses CASE WHEN with AS alias', async () => {
    const response = await POST(
      makeRequest({
        sql: `SELECT
  user_id,
  CASE WHEN age >= 18 THEN 'adult' ELSE 'minor' END AS age_group -- 年龄分组
FROM users`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('user_id');
    expect(ddl).toContain('age_group');
    expect(ddl).toContain('年龄分组');
  });

  it('parses multiple CASE WHEN with nested conditions', async () => {
    const response = await POST(
      makeRequest({
        sql: `SELECT
  order_id,
  CASE
    WHEN amount > 1000 AND status = 'PAID' THEN 'high'
    WHEN amount > 100 THEN 'medium'
    ELSE 'low'
  END AS order_level, -- 订单等级
  CASE
    WHEN amount > 5000 THEN 'VIP'
    ELSE 'normal'
  END AS cust_type -- 客户类型
FROM orders`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('order_id');
    expect(ddl).toContain('order_level');
    expect(ddl).toContain('cust_type');
    expect(ddl).toContain('订单等级');
    expect(ddl).toContain('客户类型');
  });

  // ========== CTE (WITH) ==========

  it('parses CTE with single WITH clause', async () => {
    const response = await POST(
      makeRequest({
        sql: `WITH cte AS (
  SELECT user_id, COUNT(*) AS cnt FROM orders GROUP BY user_id
)
SELECT cte.user_id AS uid, cte.cnt AS cnt FROM cte`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('uid');
    expect(ddl).toContain('cnt');
  });

  it('parses multiple CTEs separated by comma', async () => {
    const response = await POST(
      makeRequest({
        sql: `WITH
  cte1 AS (SELECT user_id, name FROM users),
  cte2 AS (SELECT user_id, amount FROM orders)
SELECT cte1.user_id AS uid, cte1.name AS uname, cte2.amount AS amt
FROM cte1 JOIN cte2 ON cte1.user_id = cte2.user_id`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    // CTE 移除后能解析出主 SELECT 的部分字段
    expect(payload.ddl).toContain('user_id');
    expect(payload.ddl).toContain('name');
    expect(payload.ddl).toContain('COMMENT');
    expect(payload.ddl).toContain('PARTITIONED BY');
  });

  // ========== 字段名内建关键词推断 ==========

  it('infers DECIMAL for fields containing amount/amt/price/qty', async () => {
    const response = await POST(
      makeRequest({
        sql: `SELECT
  order_amount AS amt,
  product_price AS price,
  product_qty AS qty
FROM orders`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    const decimalMatches = ddl.match(/DECIMAL\(24,\s?6\)/g);
    // amt, price, qty 三个字段都应该推断为 DECIMAL
    expect(decimalMatches).toHaveLength(3);
  });

  it('infers DATE for fields containing date/dt', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT trans_dt, biz_date, create_date FROM orders',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    const dateMatches = ddl.match(/DATE/g);
    expect(dateMatches).not.toBeNull();
  });

  it('infers STRING for fields containing id/icode', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT user_id AS uid, user_icode AS icode FROM users',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    // id相关字段推断为 STRING
    expect(ddl).toContain('STRING');
  });

  // ========== 注释中关键词推断 ==========

  it('infers DECIMAL from Chinese comment containing 金额/价格/数量', async () => {
    const response = await POST(
      makeRequest({
        sql: `SELECT
  col_a AS total, -- 总金额
  col_b AS unit_price, -- 商品单价
  col_c AS order_qty -- 订购数量
FROM data`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    const decimalMatches = ddl.match(/DECIMAL/g);
    expect(decimalMatches).toHaveLength(3);
  });

  // ========== Spark 默认类型 ==========

  it('uses STRING as default type for Spark when no rule matches', async () => {
    const response = await POST(
      makeRequest({
        sql: 'SELECT some_unknown_field AS uf FROM tbl',
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('STRING');
  });

  // ========== 特殊字符注释 ==========

  it('handles special characters in comments (parentheses, colons, quotes)', async () => {
    const response = await POST(
      makeRequest({
        sql: `SELECT
  flag AS is_valid, -- 是否有效 (Y/N)
  remark AS remark, -- 备注: 请填写详细说明
  name AS name -- 名称 'nickname'
FROM data`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('是否有效 (Y/N)');
    expect(ddl).toContain('备注: 请填写详细说明');
    expect(ddl).toContain('名称 nickname');
  });

  // ========== 内容变化多样 ==========

  it('handles field expressions with arithmetic operators', async () => {
    const response = await POST(
      makeRequest({
        sql: `SELECT
  (price * qty) AS total_amt, -- 总金额
  (price - discount) AS net_price -- 净价
FROM orders`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('total_amt');
    expect(ddl).toContain('net_price');
  });

  // ========== NVL/COALESCE 函数 ==========

  it('parses NVL and COALESCE expressions', async () => {
    const response = await POST(
      makeRequest({
        sql: `SELECT
  NVL(phone, 'unknown') AS phone_final, -- 联系电话
  COALESCE(email, phone) AS contact -- 联系方式
FROM users`,
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('phone_final');
    expect(ddl).toContain('contact');
  });

  // ========== 注释作为类型推断依据（中文关键词） ==========

  it('infers DATE from comment containing 日期', async () => {
    const response = await POST(
      makeRequest({
        sql: "SELECT col_x AS biz_dt -- 业务日期\nFROM data",
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('DATE');
  });

  it('infers TIMESTAMP from comment containing 时间', async () => {
    const response = await POST(
      makeRequest({
        sql: "SELECT col_y AS upd_time -- 更新时间\nFROM data",
        databaseTypes: ['spark'],
      }),
    );
    const payload = await response.json();
    const ddl = payload.ddl;

    expect(response.status).toBe(200);
    expect(ddl).toContain('TIMESTAMP');
  });
});
