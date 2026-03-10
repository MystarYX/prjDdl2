'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

interface GlobalRule {
  id: string;
  keywords: string[];
  matchType: 'contains' | 'equals' | 'prefix' | 'suffix';
  targetField: 'name' | 'comment';
  targetDatabases: string[];
  dataTypes: Record<string, string>;
  typeParams: Record<string, { precision?: number; scale?: number; length?: number; }>;
  priority: number;
}

const DB_LABELS = {
  spark: 'Spark SQL',
  mysql: 'MySQL',
  starrocks: 'StarRocks'
};

// 默认类型
const DEFAULT_TYPES = {
  spark: 'STRING',
  mysql: 'VARCHAR(256)',
  starrocks: 'VARCHAR(256)'
};

// 解析字段文本
const parseFields = (text: string): Array<{ name: string; comment: string }> => {
  const fields: Array<{ name: string; comment: string }> = [];
  const lines = text.trim().split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('--')) continue;

    // 匹配格式: ,trl.splr_trcl_sers AS splr_trcl_sers --系列供应商
    // 或者: m.acnt_org --核算组
    // 或者: acnt_org STRING COMMENT '核算组'
    // 或者: splr_trcl_sers --系列供应商

    let fieldName = '';
    let comment = '';

    // 先找 AS 关键字
    const asMatch = trimmedLine.match(/AS\s+([\w_]+)/i);
    
    // 找 -- 注释（行尾注释）
    const lineCommentMatch = trimmedLine.match(/--\s*(.+)$/);
    
    // 找 COMMENT 'xxx' 格式的注释
    const commentKeywordMatch = trimmedLine.match(/COMMENT\s+['"]([^'"]*)['"]/i);

    if (asMatch) {
      // 有 AS 的情况，取 AS 后面的作为字段名
      fieldName = asMatch[1];
    } else {
      // 没有 AS，尝试找第一个字段名
      // 支持带表别名的格式：m.acnt_org 或 t1.field_name
      const firstWordMatch = trimmedLine.match(/^,?\s*([\w_]+(?:\.[\w_]+)?)/);
      if (firstWordMatch) {
        let rawFieldName = firstWordMatch[1];
        // 去掉表别名前缀（如 m.acnt_org → acnt_org）
        const dotIndex = rawFieldName.indexOf('.');
        if (dotIndex !== -1) {
          fieldName = rawFieldName.substring(dotIndex + 1);
        } else {
          fieldName = rawFieldName;
        }
      }
    }

    if (lineCommentMatch) {
      comment = lineCommentMatch[1].trim();
      // 去掉注释外层的引号（如 --'委托方' → 委托方）
      comment = comment.replace(/^['"]+|['"]+$/g, '');
    } else if (commentKeywordMatch) {
      comment = commentKeywordMatch[1].trim();
    }

    if (fieldName) {
      fields.push({ name: fieldName, comment: comment || '' });
    }
  }

  return fields;
};

// 从规则中推断字段类型
const inferFieldType = (
  fieldName: string,
  comment: string,
  rules: GlobalRule[],
  databaseType: string
): string => {
  // 按优先级排序规则
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  // 遍历规则
  for (const rule of sortedRules) {
    // 检查规则是否适用于当前数据库类型
    if (!rule.targetDatabases.includes(databaseType)) {
      continue;
    }

    // 获取目标字段的值
    const targetValue = rule.targetField === 'name' ? fieldName : comment;
    if (!targetValue) continue;

    // 检查匹配
    let matched = false;
    for (const keyword of rule.keywords) {
      const upperTarget = targetValue.toUpperCase();
      const upperKeyword = keyword.toUpperCase();

      switch (rule.matchType) {
        case 'contains':
          if (upperTarget.includes(upperKeyword)) {
            matched = true;
          }
          break;
        case 'equals':
          if (upperTarget === upperKeyword) {
            matched = true;
          }
          break;
        case 'prefix':
          if (upperTarget.startsWith(upperKeyword)) {
            matched = true;
          }
          break;
        case 'suffix':
          if (upperTarget.endsWith(upperKeyword)) {
            matched = true;
          }
          break;
      }

      if (matched) break;
    }

    if (matched) {
      // 获取基础类型
      const baseType = rule.dataTypes[databaseType] || rule.dataTypes['spark'];
      if (!baseType) continue;

      // 获取类型参数（支持两种格式）
      // 格式1: { spark: { precision: 24, scale: 6 } }
      // 格式2: { precision: 24, scale: 6 } （直接配置，不区分数据库）
      const params = rule.typeParams[databaseType] || rule.typeParams || {};
      const upper = baseType.toUpperCase();

      // 根据参数构建完整类型字符串
      if (params.precision !== undefined && params.scale !== undefined &&
          (upper.includes('DECIMAL') || upper.includes('NUMERIC'))) {
        return `${baseType}(${params.precision}, ${params.scale})`;
      } else if (params.length !== undefined &&
                 (upper.includes('VARCHAR') || upper.includes('CHAR'))) {
        return `${baseType}(${params.length})`;
      } else if (params.precision !== undefined &&
                 (upper.includes('FLOAT') || upper.includes('DOUBLE'))) {
        return `${baseType}(${params.precision})`;
      }
      
      // DECIMAL/NUMERIC 类型如果没有配置参数，使用默认值 (24, 6)
      if (upper.includes('DECIMAL') || upper.includes('NUMERIC')) {
        return `${baseType}(24, 6)`;
      }
      
      // VARCHAR/CHAR 类型如果没有配置参数，使用默认长度
      if (upper.includes('VARCHAR') || upper.includes('CHAR')) {
        return `${baseType}(256)`;
      }

      return baseType;
    }
  }

  // 未匹配到规则，返回默认类型
  return DEFAULT_TYPES[databaseType as keyof typeof DEFAULT_TYPES];
};

// 生成 ALTER TABLE 语句
const generateAlterTable = (
  tableNames: Record<string, string>,
  fieldText: string,
  databaseTypes: string[],
  rules: GlobalRule[]
): string[] => {
  const fields = parseFields(fieldText);

  if (fields.length === 0) {
    return databaseTypes.map(dbType => `-- ${DB_LABELS[dbType as keyof typeof DB_LABELS]}\n-- 请至少添加一个字段`);
  }

  const results: string[] = [];

  for (const databaseType of databaseTypes) {
    const finalTableName = (tableNames[databaseType] || '').trim() || '表名';

    // 为每个字段推断类型
    const fieldDefinitions = fields.map(field => {
      const dataType = inferFieldType(field.name, field.comment, rules, databaseType);
      return { ...field, dataType };
    });

    switch (databaseType) {
      case 'spark':
        // Spark SQL: alter table xxx add columns (col1 STRING COMMENT 'xxx', ...)
        const sparkFields = fieldDefinitions.map(
          f => `${f.name}${' '.repeat(Math.max(30 - f.name.length, 1))}${f.dataType}${' '.repeat(Math.max(20 - f.dataType.length, 1))}COMMENT '${f.comment}'`
        );
        // 逗号前置
        const sparkFieldsWithComma = sparkFields.map((f, i) => i === 0 ? f : `    ,${f}`);
        results.push(`-- ${DB_LABELS[databaseType as keyof typeof DB_LABELS]}\nalter table ${finalTableName} add columns(\n${sparkFieldsWithComma.join('\n')}\n);`);
        break;

      case 'mysql':
        // MySQL: ALTER TABLE xxx ADD COLUMN col1 VARCHAR(256) COMMENT 'xxx', ...
        const mysqlFields = fieldDefinitions.map(
          f => `ADD COLUMN ${f.name} ${f.dataType}\t\tCOMMENT '${f.comment}'`
        );
        // 逗号前置
        const mysqlFieldsWithComma = mysqlFields.map((f, i) => i === 0 ? f : `,${f}`);
        results.push(`-- ${DB_LABELS[databaseType as keyof typeof DB_LABELS]}\nALTER TABLE ${finalTableName}\n${mysqlFieldsWithComma.join('\n')};`);
        break;

      case 'starrocks':
        // StarRocks: ALTER TABLE xxx ADD COLUMN col1 VARCHAR(256) comment 'xxx', ...
        const srFields = fieldDefinitions.map(
          f => `ADD COLUMN ${f.name} ${f.dataType} comment '${f.comment}'`
        );
        // 逗号前置
        const srFieldsWithComma = srFields.map((f, i) => i === 0 ? f : `,${f}`);
        results.push(`-- ${DB_LABELS[databaseType as keyof typeof DB_LABELS]}\nALTER TABLE ${finalTableName}\n${srFieldsWithComma.join('\n')};`);
        break;

      default:
        results.push(`-- ${DB_LABELS[databaseType as keyof typeof DB_LABELS]}\n-- 不支持的数据库类型`);
        break;
    }
  }

  return results;
};

interface AlterTabProps {
  globalRules: GlobalRule[];
}

export default function AlterTab({ globalRules }: AlterTabProps) {
  const { success, error: toastError, warning } = useToast();

  const [selectedDbTypes, setSelectedDbTypes] = useState<string[]>(['spark']);
  const [tableNames, setTableNames] = useState<Record<string, string>>({
    spark: '',
    mysql: '',
    starrocks: ''
  });
  const [fieldText, setFieldText] = useState('');
  const [alterOutput, setAlterOutput] = useState('');

  // 当输入变化时自动生成
  useEffect(() => {
    const outputs = generateAlterTable(tableNames, fieldText, selectedDbTypes, globalRules);
    setAlterOutput(outputs.join('\n\n'));
  }, [tableNames, fieldText, selectedDbTypes, globalRules]);

  const handleCopy = () => {
    if (!alterOutput.trim()) {
      warning('没有内容可复制');
      return;
    }

    // 检查是否包含实际的 SQL 语句（包含 alter table 或 ALTER TABLE）
    const hasValidSQL = /alter\s+table|ALTER\s+TABLE/i.test(alterOutput);
    if (!hasValidSQL) {
      warning('没有内容可复制');
      return;
    }

    navigator.clipboard.writeText(alterOutput);
    success('ALTER 语句已复制到剪贴板');
  };

  const handleReset = () => {
    setTableNames({
      spark: '',
      mysql: '',
      starrocks: ''
    });
    setFieldText('');
    success('已重置为默认值');
  };

  const handleDbTypeChange = (dbType: string, checked: boolean) => {
    if (checked) {
      setSelectedDbTypes([...selectedDbTypes, dbType]);
    } else {
      if (selectedDbTypes.length === 1) {
        warning('至少选择一种数据库类型');
        return;
      }
      setSelectedDbTypes(selectedDbTypes.filter(t => t !== dbType));
    }
  };

  const handleTableNameChange = (dbType: string, value: string) => {
    setTableNames(prev => ({
      ...prev,
      [dbType]: value
    }));
  };

  return (
    <div>
      {/* 数据库类型选择 */}
      <div className="bg-white rounded-xl p-6 mb-6 shadow-sm">
        <h3 className="font-semibold text-gray-800 mb-4">目标数据库类型（可多选）</h3>
        <div className="flex flex-wrap gap-3">
          {Object.entries(DB_LABELS).map(([value, label]) => (
            <label
              key={value}
              className={`flex items-center gap-2 px-4 py-2 border rounded-lg cursor-pointer transition-colors ${
                selectedDbTypes.includes(value)
                  ? 'bg-blue-50 border-blue-600 text-blue-600'
                  : 'hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                value={value}
                checked={selectedDbTypes.includes(value)}
                onChange={(e) => handleDbTypeChange(value, e.target.checked)}
                className="rounded"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* 左右两列布局 */}
      <div className="grid grid-cols-2 gap-6">
        {/* 左侧：输入区域 */}
        <div className="space-y-6">
          {/* 表名输入 - 根据选择的数据库类型动态显示 */}
          {selectedDbTypes.map(dbType => (
            <div key={dbType} className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-gray-800 whitespace-nowrap min-w-[100px]">
                  {DB_LABELS[dbType as keyof typeof DB_LABELS]} 表名
                </h3>
                <input
                  type="text"
                  value={tableNames[dbType] || ''}
                  onChange={(e) => handleTableNameChange(dbType, e.target.value)}
                  placeholder={`输入 ${DB_LABELS[dbType as keyof typeof DB_LABELS]} 表名（可选）`}
                  className="flex-1 px-4 py-2 border rounded-lg font-mono text-sm"
                />
              </div>
            </div>
          ))}

          {/* 字段输入 */}
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <h3 className="font-semibold text-gray-800 mb-4">新增字段（支持 AS 别名、-- 注释）</h3>
            <textarea
              value={fieldText}
              onChange={(e) => setFieldText(e.target.value)}
              placeholder="示例格式：
,trl.splr_trcl_sers AS splr_trcl_sers --系列供应商
,trl.splr_trcl_sers_name AS splr_trcl_sers_name --系列供应商名称

或者：
splr_trcl_sers --系列供应商
splr_trcl_sers_name --系列供应商名称"
              className="w-full h-96 p-4 border rounded-lg font-mono text-sm resize-none"
            />
          </div>
        </div>

        {/* 右侧：输出区域 */}
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-gray-800">
              ALTER TABLE 语句
            </h3>
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm hover:bg-gray-700 transition-colors"
              >
                重置
              </button>
              <button
                onClick={handleCopy}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors"
              >
                复制
              </button>
            </div>
          </div>
          <textarea
            value={alterOutput}
            readOnly
            placeholder="生成的 ALTER TABLE 语句将显示在这里..."
            className="w-full h-[448px] p-4 border rounded-lg font-mono text-sm resize-none bg-gray-50"
          />
        </div>
      </div>
    </div>
  );
}
