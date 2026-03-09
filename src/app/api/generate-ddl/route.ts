import { NextRequest, NextResponse } from 'next/server';

interface FieldInfo {
  name: string;
  alias?: string;
  comment: string;
  originalType?: string; // 原始类型定义（如果有）
}

interface InferenceRule {
  keywords: string[];
  matchType: 'contains' | 'equals' | 'regex' | 'prefix' | 'suffix';
  targetField: 'name' | 'comment';
  dataType: string;
  priority: number;
  precision?: number;
  scale?: number;
  length?: number;
}

type DatabaseType = 'spark' | 'mysql' | 'starrocks';

const DATABASE_CONFIGS: Record<DatabaseType, {
  prefix: string;
  comment: 'INLINE' | 'SEPARATE';
  addPk?: boolean;
  addEngine?: boolean;
}> = {
  spark: { prefix: 'CREATE TABLE IF NOT EXISTS', comment: 'INLINE' },
  mysql: { prefix: 'CREATE TABLE ', comment: 'INLINE', addPk: true, addEngine: true },
  starrocks: { prefix: 'CREATE TABLE ', comment: 'INLINE', addPk: true },
};

// 解析 CREATE TABLE 语句，提取字段信息
function tryParseCreateTable(sql: string): FieldInfo[] {
  const upperSql = sql.toUpperCase();

  // 检测是否是 CREATE TABLE 语句
  if (!upperSql.startsWith('CREATE TABLE')) {
    return [];
  }

  // 查找表名（CREATE TABLE IF NOT EXISTS 表名 或 CREATE TABLE 表名）
  let tableStartIndex = upperSql.indexOf('CREATE TABLE');
  tableStartIndex += 12; // 'CREATE TABLE' 的长度

  // 跳过 IF NOT EXISTS
  let startIndex = tableStartIndex;
  if (upperSql.substring(startIndex, startIndex + 12).trim() === 'IF NOT EXISTS') {
    startIndex += 12;
  }

  // 跳过空格，找到表名的起始位置
  while (startIndex < sql.length && /\s/.test(sql[startIndex])) {
    startIndex++;
  }

  // 查找第一个左括号（字段定义的开始）
  const leftParenIndex = sql.indexOf('(', startIndex);
  if (leftParenIndex === -1) {
    return [];
  }

  // 匹配括号对，找到右括号的位置
  let parenCount = 0;
  let rightParenIndex = -1;

  for (let i = leftParenIndex; i < sql.length; i++) {
    if (sql[i] === '(') {
      parenCount++;
    } else if (sql[i] === ')') {
      parenCount--;
      if (parenCount === 0) {
        rightParenIndex = i;
        break;
      }
    }
  }

  if (rightParenIndex === -1) {
    return [];
  }

  // 提取字段定义部分（括号内的内容）
  const fieldsPart = sql.substring(leftParenIndex + 1, rightParenIndex);

  // 按逗号分割字段（但要小心处理字段类型中的逗号，如 DECIMAL(10, 2)）
  const fieldLines: string[] = [];
  let current = '';
  let typeParenCount = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < fieldsPart.length; i++) {
    const char = fieldsPart[i];

    // 处理字符串（单引号或双引号）
    if ((char === "'" || char === '"') && (i === 0 || fieldsPart[i - 1] !== '\\')) {
      if (!inString) {
        inString = true;
        stringChar = char;
        current += char;
      } else if (char === stringChar) {
        inString = false;
        current += char;
      } else {
        current += char;
      }
    } else if (inString) {
      current += char;
    } else if (char === '(') {
      typeParenCount++;
      current += char;
    } else if (char === ')') {
      typeParenCount--;
      current += char;
    } else if (char === ',' && typeParenCount === 0) {
      // 遇到逗号且不在括号内，分割字段
      fieldLines.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  // 添加最后一个字段
  if (current.trim()) {
    fieldLines.push(current);
  }

  const fields: FieldInfo[] = [];

  for (const line of fieldLines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // 跳过约束定义（PRIMARY KEY, UNIQUE KEY, FOREIGN KEY, INDEX, KEY, CONSTRAINT）
    const upperLine = trimmedLine.toUpperCase();
    if (upperLine.startsWith('PRIMARY KEY') ||
        upperLine.startsWith('UNIQUE KEY') ||
        upperLine.startsWith('UNIQUE') ||
        upperLine.startsWith('FOREIGN KEY') ||
        upperLine.startsWith('INDEX') ||
        upperLine.startsWith('KEY ') ||
        upperLine.startsWith('CONSTRAINT')) {
      continue;
    }

    // 跳过以括号开头的内容（如索引定义）
    if (trimmedLine.startsWith('(')) {
      continue;
    }

    // 解析字段定义：字段名 类型 [COMMENT '注释']
    // 支持单引号和双引号的注释
    // 类型可能包含括号和逗号，如 DECIMAL(10, 2)
    // 支持 COMMENT'xxx' 和 COMMENT 'xxx' 两种格式
    const commentMatch = trimmedLine.match(/\s+COMMENT\s*['"]([^'"]*)['"]$/i);
    const comment = commentMatch ? commentMatch[1] : '';

    // 去掉注释部分
    const withoutComment = commentMatch ? trimmedLine.substring(0, commentMatch.index).trim() : trimmedLine;

    // 分割字段名和类型（支持空格和制表符）
    // 使用正则表达式匹配第一个空白字符
    const firstSpaceMatch = withoutComment.match(/\s/);
    if (!firstSpaceMatch) continue;

    const fieldName = withoutComment.substring(0, firstSpaceMatch.index!).trim();
    const fieldType = withoutComment.substring(firstSpaceMatch.index! + 1).trim();

    if (fieldName && fieldType) {
      fields.push({
        name: fieldName,
        comment: comment,
        originalType: fieldType
      });
    }
  }

  return fields;
}

// 移除CTE (WITH子句)
function removeCTE(sql: string): string {
  sql = sql.trim();

  // 检查是否以WITH开头
  if (!sql.toUpperCase().startsWith('WITH ')) {
    return sql;
  }

  let pos = 4; // 'WITH'的长度
  let endPos = 0;

  while (pos < sql.length) {
    // 跳过空格
    while (pos < sql.length && /\s/.test(sql[pos])) {
      pos++;
    }

    // 读取CTE名称
    let cteNameStart = pos;
    while (pos < sql.length && /\w/.test(sql[pos])) {
      pos++;
    }
    const cteName = sql.substring(cteNameStart, pos).trim();

    if (!cteName) {
      break; // 没有CTE名称了，结束
    }

    // 跳过空格
    while (pos < sql.length && /\s/.test(sql[pos])) {
      pos++;
    }

    // 检查是否有AS关键字
    if (pos + 2 >= sql.length ||
        sql.substring(pos, pos + 2).toUpperCase() !== 'AS') {
      break; // 不是AS了，应该是主SELECT
    }

    pos += 2; // 跳过AS

    // 跳过空格
    while (pos < sql.length && /\s/.test(sql[pos])) {
      pos++;
    }

    // 检查是否有左括号
    if (pos >= sql.length || sql[pos] !== '(') {
      break; // 不是CTE定义
    }

    // 匹配括号对
    let parenCount = 0;
    let foundEnd = false;

    for (let i = pos; i < sql.length; i++) {
      if (sql[i] === '(') {
        parenCount++;
      } else if (sql[i] === ')') {
        parenCount--;
        if (parenCount === 0) {
          endPos = i + 1;
          foundEnd = true;
          break;
        }
      }
    }

    if (!foundEnd) {
      break; // 没有找到匹配的右括号
    }

    // 更新pos到右括号后
    pos = endPos;

    // 跳过空格
    while (pos < sql.length && /\s/.test(sql[pos])) {
      pos++;
    }

    // 检查是否有逗号（还有更多CTE）
    if (pos < sql.length && sql[pos] === ',') {
      pos++; // 跳过逗号
      continue; // 继续处理下一个CTE
    } else {
      break; // 没有逗号了，所有CTE处理完成
    }
  }

  // 返回剩余的SQL（主SELECT）
  if (endPos > 0) {
    return sql.substring(endPos).trim();
  }

  return sql;
}

function parseSQLFields(sql: string): FieldInfo[] {
  const fields: FieldInfo[] = [];
  sql = sql.trim();

  // 新增：检测 CREATE TABLE 语句
  const createTableResult = tryParseCreateTable(sql);
  if (createTableResult.length > 0) return createTableResult;

  // 移除CTE子句
  sql = removeCTE(sql);

  // 策略1: 解析SELECT ... FROM（要求FROM后面有表名）
  if (sql.toUpperCase().includes('SELECT')) {
    const result = tryParseSelectFrom(sql);
    if (result.length > 0) return result;
  }

  // 策略2: SELECT后无FROM（可能是纯字段列表或不完整的SELECT语句）
  if (sql.toUpperCase().includes('SELECT')) {
    const result = tryParseSelectFields(sql);
    if (result.length > 0) return result;
  }

  // 策略3: 纯字段列表（可能包含FROM关键字，如逗号分隔的列表）
  const result = tryParseFieldList(sql);
  if (result.length > 0) return result;

  throw new Error('无法从SQL中解析出字段');
}

function tryParseSelectFrom(sql: string): FieldInfo[] {
  // 使用简单的字符串查找，避免正则表达式问题
  const selectIndex = sql.toUpperCase().indexOf('SELECT');
  if (selectIndex === -1) return [];

  const selectStart = selectIndex + 6; // 'SELECT'的长度是6
  
  let parenCount = 0;
  let fromPos = -1;

  for (let i = selectStart; i < sql.length; i++) {
    const char = sql[i];
    if (char === '(') {
      parenCount++;
    } else if (char === ')') {
      parenCount--;
    } else if (parenCount === 0 && sql.substring(i, i + 4).toUpperCase() === 'FROM') {
      // 检查FROM前面是否有字符，确保是独立的FROM关键字
      const prevChar = i === 0 ? ' ' : sql[i - 1];
      
      // FROM前面必须是空格
      if (!/\s/.test(prevChar)) {
        continue;
      }
      
      // 检查FROM后面是否有字符
      if (i + 4 >= sql.length) {
        continue;
      }
      
      const nextChar = sql[i + 4];
      
      // FROM后面必须是空格或标点符号（不能是字母数字）
      if (!/\s/.test(nextChar) && ![',', '(', ')', ';'].includes(nextChar)) {
        continue;
      }
      
      // 检查FROM后面是否有表名（非空格字符）
      let hasTableName = false;
      for (let j = i + 4; j < sql.length; j++) {
        if (!/\s/.test(sql[j])) {
          hasTableName = true;
          break;
        }
      }
      
      if (hasTableName) {
        fromPos = i;
        break;
      }
    }
  }

  if (fromPos === -1) return [];

  const selectClause = sql.substring(selectStart, fromPos).trim();
  const result = parseSelectClause(selectClause);
  return result;
}

function tryParseSelectFields(sql: string): FieldInfo[] {
  // 使用简单的字符串查找，避免正则表达式问题
  const selectIndex = sql.toUpperCase().indexOf('SELECT');
  if (selectIndex === -1) return [];

  const selectStart = selectIndex + 6; // 'SELECT'的长度是6
  let selectClause = sql.substring(selectStart).trim();

  const stopKeywords = ['WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'UNION', 'FROM'];
  for (const keyword of stopKeywords) {
    const keywordIndex = selectClause.toUpperCase().indexOf(keyword);
    if (keywordIndex !== -1) {
      selectClause = selectClause.substring(0, keywordIndex).trim();
      break;
    }
  }

  return parseSelectClause(selectClause);
}

function extractCommentMap(lines: string[]): Record<string, string> {
  const commentMap: Record<string, string> = {};

  for (const line of lines) {
    // 匹配注释：-- 注释内容（可能以逗号结尾）
    const match = line.match(/--\s*(.+?)(?:,)?$/);
    if (match) {
      // 去掉注释中的引号，避免在生成DDL时出现引号问题
      const comment = match[1].trim().replace(/[`'""]/g, '');
      const fieldPart = line.substring(0, match.index).trim();

      if (fieldPart) {
        // 去掉字段表达式末尾的逗号
        let normalizedKey = fieldPart.replace(/^,/, '').replace(/,$/, '').trim();

        // 提取AS别名
        let alias = null;
        const asMatch = normalizedKey.match(/^(.+?)\s+AS\s+([^\s,]+)$/i);
        if (asMatch) {
          normalizedKey = asMatch[1].trim();
          alias = asMatch[2].trim().replace(/['"`]/g, '');
        } else {
          const parts = normalizedKey.split(/\s+/);
          if (parts.length > 1) {
            const lastPart = parts[parts.length - 1];
            const containsOperator = ['(', '+', '-', '*', '/', '='].some(op =>
              normalizedKey.substring(0, normalizedKey.lastIndexOf(lastPart)).includes(op)
            );
            if (!containsOperator && !lastPart.includes('(') && !lastPart.includes(')')) {
              normalizedKey = parts.slice(0, -1).join(' ');
              alias = lastPart.trim().replace(/['"`]/g, '');
            }
          }
        }

        normalizedKey = normalizedKey.replace(/\s+/g, ' ').trim();

        // 存储注释到多个key：表达式和别名
        commentMap[normalizedKey] = comment;
        if (alias) {
          commentMap[alias] = comment;
        }
      }
    }
  }

  return commentMap;
}

// 解析单个字段定义（包含类型和注释）
function parseFieldDefinition(line: string): FieldInfo | null {
  const trimmedLine = line.trim();
  if (!trimmedLine) return null;

  // 检查是否包含注释（支持 -- 和 COMMENT 两种格式）
  let comment = '';
  let withoutComment = trimmedLine;

  // 格式1: -- 注释
  const lineCommentMatch = trimmedLine.match(/\s+--\s*(.+)$/);
  if (lineCommentMatch) {
    comment = lineCommentMatch[1].trim();
    withoutComment = trimmedLine.substring(0, lineCommentMatch.index).trim();
  } else {
    // 格式2: COMMENT '注释'
    const commentMatch = trimmedLine.match(/\s+COMMENT\s+['"]([^'"]*)['"]$/i);
    if (commentMatch) {
      comment = commentMatch[1].trim();
      withoutComment = trimmedLine.substring(0, commentMatch.index).trim();
    }
  }

  // 按空格分割，提取字段名
  const parts = withoutComment.split(/\s+/);
  if (parts.length === 0) return null;

  const fieldName = parts[0].trim();
  if (!fieldName) return null;

  // 提取类型（如果有）
  let originalType: string | undefined;
  if (parts.length >= 2) {
    // 查找类型部分（字段名之后到注释之前）
    const typeParts = [];
    for (let i = 1; i < parts.length; i++) {
      typeParts.push(parts[i]);
    }
    originalType = typeParts.join(' ');
  }

  return {
    name: fieldName,
    comment: comment,
    originalType: originalType
  };
}

// 检查字段是否包含类型定义
function hasTypeDefinition(expr: string): boolean {
  const trimmed = expr.trim();
  // 常见的SQL类型关键字
  const typeKeywords = [
    'STRING', 'VARCHAR', 'CHAR', 'DECIMAL', 'NUMERIC', 'INT', 'INTEGER', 'BIGINT',
    'SMALLINT', 'TINYINT', 'FLOAT', 'DOUBLE', 'BOOLEAN', 'DATE', 'DATETIME',
    'TIMESTAMP', 'TIME', 'TEXT', 'BLOB', 'JSON', 'ARRAY', 'MAP', 'STRUCT'
  ];
  const upperExpr = trimmed.toUpperCase();
  
  // 使用正则表达式确保类型关键字是独立的单词，而不是函数名的一部分
  // 例如：current_timestamp() 不应该被匹配
  for (const type of typeKeywords) {
    // 匹配：开头是类型，或者前面有非单词字符（空格、逗号、开括号等）
    // 后面必须是空格、逗号或结尾
    const regex = new RegExp(`(^|\\W)${type}($|\\W)`);
    if (regex.test(upperExpr)) {
      return true;
    }
  }
  
  return false;
}

function tryParseFieldList(sql: string): FieldInfo[] {
  const cleanSQL = sql.replace(/--.*?(,)?$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  
  // 过滤掉 FROM 关键字及其之后的内容
  const fromIndex = cleanSQL.toUpperCase().indexOf(' FROM ');
  const filteredSQL = fromIndex !== -1 ? cleanSQL.substring(0, fromIndex).trim() : cleanSQL;
  
  const commentMap = extractCommentMap(sql.split('\n'));
  const fieldExpressions = splitFields(filteredSQL);

  const fields: FieldInfo[] = [];

  for (const expr of fieldExpressions) {
    const trimmedExpr = expr.trim();
    if (!trimmedExpr) continue;

    // 检查是否包含 COMMENT 'xxx' 格式（调整3：优先检测 COMMENT 格式）
    const hasCommentFormat = /\s+COMMENT\s+['"][^'"]*['"]\s*$/i.test(trimmedExpr);
    
    // 检查是否包含类型定义
    if (hasTypeDefinition(expr) || hasCommentFormat) {
      // 使用解析字段定义的逻辑
      const fieldDef = parseFieldDefinition(trimmedExpr);
      if (fieldDef) {
        fields.push(fieldDef);
      }
    } else {
      // 使用普通的字段表达式解析逻辑
      const field = parseFieldExpression(trimmedExpr, commentMap);
      if (field) {
        fields.push(field);
      }
    }
  }

  return fields;
}

function parseSelectClause(selectClause: string): FieldInfo[] {
  const commentMap = extractCommentMap(selectClause.split('\n'));
  const cleanClause = selectClause.replace(/--.*?(,)?$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
  const fieldExpressions = splitFields(cleanClause);

  return fieldExpressions
    .map(expr => parseFieldExpression(expr, commentMap))
    .filter((f): f is FieldInfo => f !== null);
}

function splitFields(selectClause: string): string[] {
  const fieldExpressions: string[] = [];
  let current = '';
  let parenCount = 0;
  let caseCount = 0;
  let i = 0;

  while (i < selectClause.length) {
    const char = selectClause[i];

    // 检查是否是 CASE 关键字（必须在单词边界上）
    if (parenCount === 0 && caseCount === 0 &&
        char.toUpperCase() === 'C' &&
        selectClause.substring(i, i + 4).toUpperCase() === 'CASE') {
      // 检查前后是否为单词边界
      const prevChar = i === 0 ? ' ' : selectClause[i - 1];
      const nextChar = i + 4 >= selectClause.length ? ' ' : selectClause[i + 4];

      // 前面必须是空格，后面必须是空格或标点符号（确保单词边界）
      if (/\s/.test(prevChar) && (/\s/.test(nextChar) || /[(),;]$/.test(nextChar))) {
        caseCount++;
      }
      current += char;
    }
    // 检查是否是 END 关键字
    else if (caseCount > 0 && char.toUpperCase() === 'E' &&
             selectClause.substring(i, i + 3).toUpperCase() === 'END') {
      const prevChar = i === 0 ? ' ' : selectClause[i - 1];
      const nextChar = i + 3 >= selectClause.length ? ' ' : selectClause[i + 3];

      // 前面必须是空格，后面必须是空格或标点符号（确保单词边界）
      if (/\s/.test(prevChar) && (/\s/.test(nextChar) || /[(),;]$/.test(nextChar))) {
        caseCount--;
      }
      current += char;
    }
    // 处理括号
    else if (char === '(') {
      parenCount++;
      current += char;
    } else if (char === ')') {
      parenCount--;
      current += char;
    }
    // 处理逗号（只有在括号和CASE都关闭时才分割）
    else if (char === ',' && parenCount === 0 && caseCount === 0) {
      fieldExpressions.push(current.trim());
      current = '';
    } else {
      current += char;
    }

    i++;
  }

  if (current.trim()) {
    fieldExpressions.push(current.trim());
  }

  return fieldExpressions;
}

// 清理表别名（如 t1.order_id → order_id）
function removeTableAlias(expr: string): string {
  // 匹配表别名前缀（如 t1. 或 alias.）
  // 支持多种格式：t1.field, `t1`.`field`, "t1"."field"
  return expr.replace(/^\s*[\w`"]+\.\s*[\w`"]+\s*/g, match => {
    // 去除表别名和点，只保留字段名
    return match.replace(/^[\w`"]+\./, '').trim();
  });
}

function parseFieldExpression(expr: string, commentMap?: Record<string, string>): FieldInfo | null {
  expr = expr.trim();

  if (!commentMap) commentMap = {};

  // 过滤掉包含子查询的字段
  if (expr.toUpperCase().includes('SELECT') ||
      (expr.toUpperCase().includes('FROM') && expr.toUpperCase().includes('('))) {
    return null;
  }

  expr = expr.replace(/\bDISTINCT\s+/gi, '');

  // 规范化表达式用于注释查找
  const normalizeExpr = (e: string) => e.replace(/\s+/g, ' ').trim();

  // 处理显式AS别名（确保AS是独立的单词）
  const aliasMatch = expr.match(/(?:^|\s)AS\s+([^\s,]+)$/i);
  if (aliasMatch) {
    const mainExpr = expr.substring(0, aliasMatch.index).trim();
    const alias = aliasMatch[1].trim().replace(/['"`]/g, '');

    // 使用规范化后的表达式查找注释
    const normalizedMainExpr = normalizeExpr(mainExpr);
    let comment = commentMap[normalizedMainExpr] || commentMap[alias] || '';

    // 如果找不到注释，且表达式包含CASE关键字，尝试用最后一部分的简化表达式查找
    if (!comment && mainExpr.toUpperCase().includes('CASE')) {
      // 注释可能在最后一行，只提取了最后一部分（如 "end"）
      // 尝试从mainExpr中提取最后一行或最后一个标识符
      const lastWordMatch = mainExpr.match(/(\w+)\s*$/i);
      if (lastWordMatch) {
        comment = commentMap[lastWordMatch[1]] || '';
      }
    }

    // 清理表别名
    const cleanedMainExpr = removeTableAlias(mainExpr);

    return { name: cleanedMainExpr, alias, comment };
  }

  // 处理隐式别名（无AS关键字的最后一部分）
  const parts = expr.split(/\s+/);
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1].trim().replace(/['"`]/g, '');
    const containsOperator = ['(', '+', '-', '*', '/', '='].some(op =>
      parts.slice(0, -1).join(' ').includes(op)
    );
    // 只有当不包含运算符，且最后一部分不是函数或复杂表达式时，才认为是别名
    if (!containsOperator && !lastPart.includes('(') && !lastPart.includes(')')) {
      const name = parts.slice(0, -1).join(' ');
      const normalizedMainExpr = normalizeExpr(name);

      // 使用规范化后的表达式和别名查找注释
      const comment = commentMap[normalizedMainExpr] || commentMap[lastPart] || '';

      // 清理表别名
      const cleanedName = removeTableAlias(name);

      return { name: cleanedName, alias: lastPart, comment };
    }
  }

  const name = expr;
  const normalizedMainExpr = normalizeExpr(name);
  const comment = commentMap[normalizedMainExpr] || '';

  // 清理表别名
  const cleanedName = removeTableAlias(name);

  return { name: cleanedName, alias: undefined, comment };
}

interface TypeInfo {
  type: string;
  precision?: number;
  scale?: number;
  length?: number;
}

function inferFieldType(fieldName: string, fieldComment: string, customRules?: InferenceRule[], databaseType?: DatabaseType): TypeInfo {
  const name = fieldName.toLowerCase();
  const comment = fieldComment.toLowerCase();

  // 只使用规则管理器配置的规则
  if (customRules && customRules.length > 0) {
    const sortedRules = [...customRules].sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      const targetText = rule.targetField === 'name' ? name : comment;

      for (const keyword of rule.keywords) {
        const keywordLower = keyword.toLowerCase();

        if (rule.matchType === 'equals' && targetText === keywordLower) {
          return { type: rule.dataType, precision: rule.precision, scale: rule.scale, length: rule.length };
        } else if (rule.matchType === 'contains' && targetText.includes(keywordLower)) {
          return { type: rule.dataType, precision: rule.precision, scale: rule.scale, length: rule.length };
        } else if (rule.matchType === 'prefix' && targetText.startsWith(keywordLower)) {
          return { type: rule.dataType, precision: rule.precision, scale: rule.scale, length: rule.length };
        } else if (rule.matchType === 'suffix' && targetText.endsWith(keywordLower)) {
          return { type: rule.dataType, precision: rule.precision, scale: rule.scale, length: rule.length };
        } else if (rule.matchType === 'regex') {
          try {
            const regex = new RegExp(keyword, 'i');
            if (regex.test(targetText)) {
              return { type: rule.dataType, precision: rule.precision, scale: rule.scale, length: rule.length };
            }
          } catch {
            // 无效的正则表达式，跳过
          }
        }
      }
    }
  }

  // 如果没有匹配到规则，根据数据库类型返回固定的默认类型
  if (databaseType === 'spark') {
    return { type: 'STRING' };
  } else if (databaseType === 'mysql' || databaseType === 'starrocks') {
    return { type: 'VARCHAR', length: 256 };
  }

  // 默认返回 STRING
  return { type: 'STRING' };
}

function mapDataType(typeInfo: TypeInfo | string, databaseType: DatabaseType): string {
  if (typeof typeInfo === 'string') {
    // 兼容旧版本
    return typeInfo.toUpperCase();
  }

  // 新版本：处理类型对象
  const data_type = typeInfo.type.toUpperCase();
  const { precision, scale, length } = typeInfo;

  // MySQL, Spark, StarRocks
  if (data_type === 'STRING') {
    return databaseType === 'spark' ? 'STRING' : 'VARCHAR(255)';
  }
  if (data_type.startsWith('DECIMAL')) {
    return precision && scale ? `DECIMAL(${precision},${scale})` : 'DECIMAL(24,6)';
  }
  if (data_type === 'TIMESTAMP') {
    return databaseType === 'spark' ? 'TIMESTAMP' : 'DATETIME';
  }
  if (data_type === 'VARCHAR' || data_type === 'CHAR') {
    return length ? `${data_type}(${length})` : 'VARCHAR(255)';
  }
  if (data_type.startsWith('FLOAT')) {
    return precision ? `FLOAT(${precision})` : 'FLOAT';
  }
  if (data_type.startsWith('DOUBLE')) {
    return precision ? `DOUBLE(${precision})` : 'DOUBLE';
  }

  return data_type;
}

function selectPrimaryKey(fields: FieldInfo[]): string | null {
  if (fields.length === 0) return null;

  // 优先使用第一个字段作为主键
  return fields[0].alias || fields[0].name;
}

// ==================== 公共辅助函数 ====================

// 生成字段定义部分（公共逻辑）
function generateFieldDefinitions(adjustedFields: Array<{name: string, type: string, comment: string}>): string[] {
  const maxName = Math.max(...adjustedFields.map(f => f.name.length), 30);
  const maxType = 18;
  const ddlParts: string[] = [];

  adjustedFields.forEach((field, idx) => {
    const paddedName = field.name.padEnd(maxName);
    const paddedType = field.type.padEnd(maxType);
    const commentText = `COMMENT '${field.comment.replace(/'/g, "''")}'`;

    if (idx === 0) {
      ddlParts.push(`    ${paddedName} ${paddedType} ${commentText}`);
    } else {
      ddlParts.push(`   ,${paddedName} ${paddedType} ${commentText}`);
    }
  });

  return ddlParts;
}

// 生成 PRIMARY KEY 部分（公共逻辑）
function generatePrimaryKey(fields: FieldInfo[]): string | null {
  const pk = selectPrimaryKey(fields);
  if (pk) {
    return `   ,PRIMARY KEY (${pk})`;
  }
  return null;
}

// ==================== 数据库类型DDL生成函数 ====================

function generateSparkDDL(adjustedFields: Array<{name: string, type: string, comment: string}>, fields: FieldInfo[]): string {
  const config = DATABASE_CONFIGS['spark'];
  const ddlParts: string[] = [`${config.prefix} 表名 (`];

  // 字段定义
  ddlParts.push(...generateFieldDefinitions(adjustedFields));

  ddlParts.push(')');

  // Spark 特定配置：表注释、分区、存储格式、生命周期
  ddlParts.push("COMMENT ''");
  ddlParts.push("PARTITIONED BY (pt STRING COMMENT '日分区')");
  ddlParts.push("STORED AS ORC");
  ddlParts.push("LIFECYCLE 10;");

  return ddlParts.join('\n');
}

function generateMySQLDDL(adjustedFields: Array<{name: string, type: string, comment: string}>, fields: FieldInfo[]): string {
  const config = DATABASE_CONFIGS['mysql'];
  const ddlParts: string[] = [`${config.prefix} 表名 (`];

  // 字段定义
  ddlParts.push(...generateFieldDefinitions(adjustedFields));

  // PRIMARY KEY
  if (config.addPk) {
    const pk = generatePrimaryKey(fields);
    if (pk) ddlParts.push(pk);
  }

  ddlParts.push(')');

  // MySQL 特定配置：ENGINE、ROW_FORMAT、COMMENT
  ddlParts.push('ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT=\'\'');

  return ddlParts.join('\n');
}

function generateStarRocksDDL(adjustedFields: Array<{name: string, type: string, comment: string}>, fields: FieldInfo[]): string {
  const config = DATABASE_CONFIGS['starrocks'];
  const ddlParts: string[] = [`${config.prefix} 表名 (`];

  // 字段定义
  ddlParts.push(...generateFieldDefinitions(adjustedFields));

  ddlParts.push(')');

  // ENGINE
  ddlParts.push('ENGINE=OLAP');

  // PRIMARY KEY 和 DISTRIBUTED BY HASH
  if (config.addPk) {
    const pkField = selectPrimaryKey(fields);
    if (pkField) {
      ddlParts.push(`PRIMARY KEY (${pkField})`);
      ddlParts.push("COMMENT ''");
      ddlParts.push(`DISTRIBUTED BY HASH(${pkField}) BUCKETS 10`);
    } else {
      // 如果没有找到主键，使用第一个字段作为分片键
      if (adjustedFields.length > 0) {
        ddlParts.push("COMMENT ''");
        ddlParts.push(`DISTRIBUTED BY HASH(${adjustedFields[0].name}) BUCKETS 10`);
      }
    }
  }

  // PROPERTIES
  ddlParts.push('PROPERTIES (');
  ddlParts.push('    "replication_num" = "3",');
  ddlParts.push('    "in_memory" = "false",');
  ddlParts.push('    "enable_persistent_index" = "true",');
  ddlParts.push('    "replicated_storage" = "true",');
  ddlParts.push('    "compression" = "LZ4"');
  ddlParts.push(')');

  return ddlParts.join('\n');
}

function generateDDL(fields: FieldInfo[], customRules: Record<string, InferenceRule[]>, databaseType: DatabaseType): string {
  const dbRules = customRules[databaseType] || [];

  // 调整字段：优先使用别名作为字段名
  const adjustedFields = fields.map(field => {
    const fieldName = field.alias || field.name;
    
    // StarRocks/MySQL: 忽略原始类型，统一使用推断的类型
    // Spark: 保留原逻辑（有原始类型则使用原始类型）
    let fieldType: string;
    if (databaseType === 'starrocks' || databaseType === 'mysql') {
      // StarRocks/MySQL 统一使用推断的类型
      const typeInfo = inferFieldType(fieldName, field.comment, dbRules, databaseType);
      fieldType = mapDataType(typeInfo, databaseType);
    } else if (field.originalType && field.originalType.trim()) {
      fieldType = field.originalType.trim();
    } else {
      const typeInfo = inferFieldType(fieldName, field.comment, dbRules, databaseType);
      fieldType = mapDataType(typeInfo, databaseType);
    }
    
    return {
      name: fieldName,
      type: fieldType,
      comment: field.comment
    };
  });

  // 检查是否有有效字段
  if (adjustedFields.length === 0) {
    throw new Error('没有有效的字段用于生成DDL');
  }

  // 根据数据库类型调用对应的生成函数
  switch (databaseType) {
    case 'spark':
      return generateSparkDDL(adjustedFields, fields);
    case 'mysql':
      return generateMySQLDDL(adjustedFields, fields);
    case 'starrocks':
      return generateStarRocksDDL(adjustedFields, fields);
    default:
      return generateSparkDDL(adjustedFields, fields); // 默认使用Spark
  }
}

function generateMultipleDDLs(fields: FieldInfo[], customRules: Record<string, InferenceRule[]>, databaseTypes: DatabaseType[]) {
  const ddls = databaseTypes
    .filter(dbType => dbType in DATABASE_CONFIGS)
    .map(dbType => ({
      databaseType: dbType,
      label: dbType.charAt(0).toUpperCase() + dbType.slice(1),
      ddl: generateDDL(fields, customRules, dbType)
    }));

  if (ddls.length === 1) {
    return { ddl: ddls[0].ddl };
  }
  return { ddls };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sql, rulesByDatabase, databaseTypes } = body;

    if (!sql || typeof sql !== 'string') {
      return NextResponse.json({ error: '请提供有效的SQL查询语句' }, { status: 400 });
    }

    const fields = parseSQLFields(sql.trim());
    if (fields.length === 0) {
      return NextResponse.json({ error: '未能从SQL中解析出字段' }, { status: 400 });
    }

    const dbTypes: DatabaseType[] = databaseTypes || ['spark'];
    const customRules: Record<string, InferenceRule[]> = rulesByDatabase || {};

    const result = generateMultipleDDLs(fields, customRules, dbTypes);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '生成失败' },
      { status: 500 }
    );
  }
}
