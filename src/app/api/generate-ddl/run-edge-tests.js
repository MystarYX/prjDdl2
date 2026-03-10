#!/usr/bin/env node

/**
 * 边界条件测试 - 测试代码梳理发现的问题
 */

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  gray: '\x1b[90m'
};

const API_URL = 'http://localhost:5000/api/generate-ddl';

async function callAPI(input) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'API调用失败');
  return result;
}

async function runEdgeCaseTests() {
  console.log(`${colors.blue}\n========================================${colors.reset}`);
  console.log(`${colors.blue}   边界条件测试${colors.reset}`);
  console.log(`${colors.blue}========================================${colors.reset}\n`);

  const tests = [
    {
      name: 'CASE 关键字误识别测试',
      description: '测试包含 CASES 字段的SQL不会被误识别为 CASE WHEN',
      input: {
        sql: "SELECT case_status AS status, -- 案件状态\n  user_id AS id -- 用户ID\nFROM cases_table",
        databaseTypes: ["spark"]
      },
      validate: (result) => {
        const ddl = result.ddl;
        // 验证字段正确解析，且包含正确的注释
        return ddl.includes('status') && ddl.includes('COMMENT \'案件状态\'') && ddl.includes('id');
      }
    },
    {
      name: '字段名包含 AS 关键字测试',
      description: '测试字段名包含 AS 关键字时的别名提取',
      input: {
        sql: "SELECT basic_asset AS asset, -- 基础资产\n  asset_id AS id -- 资产ID\nFROM asset_table",
        databaseTypes: ["spark"]
      },
      validate: (result) => {
        const ddl = result.ddl;
        return ddl.includes('asset') && ddl.includes('COMMENT \'基础资产\'') && ddl.includes('id');
      }
    },
    {
      name: 'END 关键字误识别测试',
      description: '测试包含 ENDS 字段的SQL不会被误识别为 END',
      input: {
        sql: "SELECT ends_at AS end_time, -- 结束时间\n  starts_at AS start_time -- 开始时间\nFROM events",
        databaseTypes: ["spark"]
      },
      validate: (result) => {
        const ddl = result.ddl;
        return ddl.includes('end_time') && ddl.includes('COMMENT \'结束时间\'') && ddl.includes('start_time');
      }
    },
    {
      name: '多个 AS 关键字测试',
      description: '测试表达式中包含多个 AS 关键字时的别名提取',
      input: {
        sql: "SELECT user_status AS status, -- 用户状态\n  asset_type AS type -- 资产类型\nFROM user_assets",
        databaseTypes: ["spark"]
      },
      validate: (result) => {
        const ddl = result.ddl;
        return ddl.includes('status') && ddl.includes('COMMENT \'用户状态\'') &&
               ddl.includes('type') && ddl.includes('COMMENT \'资产类型\'');
      }
    },
    {
      name: 'CASE WHEN 后跟逗号测试',
      description: '测试 CASE WHEN 表达式后面直接跟逗号的情况',
      input: {
        sql: "SELECT CASE WHEN age > 18 THEN 'adult' ELSE 'minor' END AS age_group, -- 年龄分组\n  user_id AS id -- 用户ID\nFROM users",
        databaseTypes: ["spark"]
      },
      validate: (result) => {
        const ddl = result.ddl;
        return ddl.includes('age_group') && ddl.includes('COMMENT \'年龄分组\'') && ddl.includes('id');
      }
    },
    {
      name: 'FROM 关键字在字符串中测试',
      description: '测试字符串中包含 FROM 关键字不会影响解析',
      input: {
        sql: "SELECT 'from_table' AS table_name, -- 表名\n  user_id AS id -- 用户ID\nFROM users",
        databaseTypes: ["spark"]
      },
      validate: (result) => {
        const ddl = result.ddl;
        return ddl.includes('table_name') && ddl.includes('COMMENT \'表名\'') && ddl.includes('id');
      }
    },
    {
      name: '逗号前有注释测试',
      description: '测试逗号前有注释的情况',
      input: {
        sql: "SELECT user_id AS id, -- 用户ID\n  user_name AS name, -- 用户名称\n  order_amount AS amount -- 订单金额\nFROM orders",
        databaseTypes: ["spark"]
      },
      validate: (result) => {
        const ddl = result.ddl;
        return ddl.includes('COMMENT \'用户ID\'') &&
               ddl.includes('COMMENT \'用户名称\'') &&
               ddl.includes('COMMENT \'订单金额\'');
      }
    },
    {
      name: '多个连续空格测试',
      description: '测试字段表达式中有多个连续空格的情况',
      input: {
        sql: "SELECT  user_id   AS  id,  --  用户ID\n  user_name  AS  name  --  用户名称\nFROM  users",
        databaseTypes: ["spark"]
      },
      validate: (result) => {
        const ddl = result.ddl;
        return ddl.includes('id') && ddl.includes('name');
      }
    },
    {
      name: '注释包含逗号测试',
      description: '测试注释内容中包含逗号的情况',
      input: {
        sql: "SELECT user_id AS id, -- 用户ID,唯一标识\n  user_name AS name -- 用户名称,显示名称\nFROM users",
        databaseTypes: ["spark"]
      },
      validate: (result) => {
        const ddl = result.ddl;
        // 注释中的逗号应该被保留（因为逗号是注释内容的一部分）
        return ddl.includes('COMMENT \'用户ID,唯一标识\'') &&
               ddl.includes('COMMENT \'用户名称,显示名称\'');
      }
    },
    {
      name: '表别名前缀测试',
      description: '测试字段名包含表别名前缀的情况',
      input: {
        sql: "SELECT t1.user_id AS id, -- 用户ID\n  t1.user_name AS name, -- 用户名称\n  t2.order_amount AS amount -- 订单金额\nFROM users t1\nJOIN orders t2 ON t1.user_id = t2.user_id",
        databaseTypes: ["spark"]
      },
      validate: (result) => {
        const ddl = result.ddl;
        return ddl.includes('id') && ddl.includes('name') && ddl.includes('amount');
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    console.log(`${colors.blue}📋 测试 ${i + 1}/${tests.length}: ${test.name}${colors.reset}`);
    console.log(`${colors.gray}  ${test.description}${colors.reset}`);

    try {
      const result = await callAPI(test.input);
      const isValid = test.validate(result);

      if (isValid) {
        console.log(`${colors.green}  ✅ 通过${colors.reset}`);
        passed++;
      } else {
        console.log(`${colors.red}  ❌ 验证失败${colors.reset}`);
        console.log(`${colors.gray}  DDL: ${result.ddl.substring(0, 200)}...${colors.reset}`);
        failed++;
      }
    } catch (error) {
      console.log(`${colors.red}  ❌ 异常: ${error.message}${colors.reset}`);
      failed++;
    }
    console.log('');
  }

  console.log(`${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.blue}   测试结果汇总${colors.reset}`);
  console.log(`${colors.blue}========================================${colors.reset}\n`);
  console.log(`总计: ${tests.length} 个测试`);
  console.log(`${colors.green}✓ 通过: ${passed}${colors.reset}`);
  if (failed > 0) {
    console.log(`${colors.red}✗ 失败: ${failed}${colors.reset}`);
  }
  console.log(`\n${colors.blue}========================================${colors.reset}\n`);

  process.exitCode = failed > 0 ? 1 : 0;
}

runEdgeCaseTests().catch(error => {
  console.error(`${colors.red}❌ 测试执行失败: ${error.message}${colors.reset}`);
  process.exitCode = 1;
});
