export interface GlobalRule {
  id: string;
  keywords: string[];
  matchType: 'contains' | 'equals' | 'prefix' | 'suffix';
  targetField: 'name' | 'comment';
  targetDatabases: string[];
  dataTypes: Record<string, string>;
  typeParams: Record<string, { precision?: number; scale?: number; length?: number }>;
  priority: number;
}

export interface CodeToNameConfigRow {
  id: string;
  tableEnName: string;
  tableChineseName: string;
  tableAlias: string;
  dimTableField: string;
  mainTableField: string;
  extraConditions: string;
  requireFields: string;
}

export const DEFAULT_RULE_SCOPE_KEY = 'global';
export const DEFAULT_CODE_TO_NAME_SCOPE_KEY = 'global';

export const DEFAULT_GLOBAL_RULES: GlobalRule[] = [
  {
    id: 'rule-1',
    keywords: ['amt', 'amount', 'price', '金额', '价格'],
    matchType: 'contains',
    targetField: 'name',
    targetDatabases: ['spark'],
    dataTypes: {
      spark: 'DECIMAL',
    },
    typeParams: {
      spark: { precision: 24, scale: 6 },
    },
    priority: 1,
  },
  {
    id: 'rule-2',
    keywords: ['date', '日期'],
    matchType: 'contains',
    targetField: 'name',
    targetDatabases: ['spark'],
    dataTypes: {
      spark: 'DATE',
    },
    typeParams: {},
    priority: 1,
  },
  {
    id: 'rule-3',
    keywords: ['time', 'timestamp', '时间'],
    matchType: 'contains',
    targetField: 'name',
    targetDatabases: ['spark'],
    dataTypes: {
      spark: 'TIMESTAMP',
    },
    typeParams: {},
    priority: 1,
  },
  {
    id: 'rule-4',
    keywords: ['id', 'icode'],
    matchType: 'contains',
    targetField: 'name',
    targetDatabases: ['spark'],
    dataTypes: {
      spark: 'STRING',
    },
    typeParams: {},
    priority: 1,
  },
  {
    id: 'rule-5',
    keywords: ['name', '名称', '描述', '备注'],
    matchType: 'contains',
    targetField: 'name',
    targetDatabases: ['spark'],
    dataTypes: {
      spark: 'STRING',
    },
    typeParams: {},
    priority: 1,
  },
];

export const DEFAULT_CODE_TO_NAME_CONFIG: CodeToNameConfigRow[] = [];
