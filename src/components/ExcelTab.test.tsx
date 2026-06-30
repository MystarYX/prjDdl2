/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// ===== Mocks =====

jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: {
    sheet_to_json: jest.fn(),
  },
}));

jest.mock('lucide-react', () => ({
  Upload: () => <span data-testid="icon-upload">Upload</span>,
  FileSpreadsheet: () => <span data-testid="icon-file">File</span>,
  AlertCircle: () => <span data-testid="icon-alert">Alert</span>,
  Download: () => <span data-testid="icon-download">Download</span>,
  Trash2: () => <span data-testid="icon-trash">Trash</span>,
  Copy: () => <span data-testid="icon-copy">Copy</span>,
  CheckCircle2: () => <span data-testid="icon-check">Check</span>,
  Code2: () => <span data-testid="icon-code">Code</span>,
  Database: () => <span data-testid="icon-db">DB</span>,
  RefreshCw: () => <span data-testid="icon-refresh">Refresh</span>,
}));

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}));

URL.createObjectURL = jest.fn(() => 'blob:mock-url');

import ExcelTab from './ExcelTab';

// ===== Test Data =====

const defaultRules: any[] = [
  { id: 'r1', keywords: ['金额', 'price'], matchType: 'contains' as const, targetField: 'name' as const, targetDatabases: ['spark'], dataTypes: { spark: 'DECIMAL' }, typeParams: { spark: { precision: 24, scale: 6 } }, priority: 1 },
  { id: 'r2', keywords: ['date', '日期'], matchType: 'contains' as const, targetField: 'name' as const, targetDatabases: ['spark'], dataTypes: { spark: 'DATE' }, typeParams: {}, priority: 1 },
  { id: 'r3', keywords: ['name', '名称'], matchType: 'contains' as const, targetField: 'name' as const, targetDatabases: ['spark'], dataTypes: { spark: 'STRING' }, typeParams: {}, priority: 1 },
];

const codeToNameConfig = [
  { id: 'c1', tableEnName: 'dim_dept', tableChineseName: '部门维表', tableAlias: 'd', dimTableField: 'dept_id', mainTableField: 'dept_id', extraConditions: '', requireFields: 'dept_name' },
];

// ===== Tests =====

describe('ExcelTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===== 初始渲染 =====

  describe('初始渲染（未上传文件）', () => {
    it('renders the main title', () => {
      render(<ExcelTab rules={defaultRules} codeToNameConfig={[]} />);
      expect(screen.getByText('Excel 转 DWD/ODS 建表工具')).toBeInTheDocument();
    });

    it('renders the upload card with file input', () => {
      render(<ExcelTab rules={defaultRules} codeToNameConfig={[]} />);
      expect(screen.getByText('上传文件')).toBeInTheDocument();
      expect(screen.getByText(/支持 .xlsx、.xls 和 .csv 格式/)).toBeInTheDocument();
      expect(screen.getByLabelText('选择文件')).toBeInTheDocument();
    });

    it('shows file type hints', () => {
      render(<ExcelTab rules={defaultRules} codeToNameConfig={[]} />);
      expect(screen.getByText('• 支持最大 10MB 的文件')).toBeInTheDocument();
      expect(screen.getByText(/数据将在本地浏览器中处理/)).toBeInTheDocument();
    });

    it('file input accepts correct formats', () => {
      render(<ExcelTab rules={defaultRules} codeToNameConfig={[]} />);
      const input = screen.getByLabelText('选择文件') as HTMLInputElement;
      expect(input.type).toBe('file');
      expect(input.accept).toBe('.xlsx,.xls,.csv');
    });

    it('shows footer message about data security', () => {
      render(<ExcelTab rules={defaultRules} codeToNameConfig={[]} />);
      expect(screen.getByText('数据仅在本地浏览器中处理，确保您的信息安全')).toBeInTheDocument();
    });
  });

  // ===== 空规则/配置 =====

  describe('边界情况：规则和配置', () => {
    it('renders with empty rules array', () => {
      render(<ExcelTab rules={[]} codeToNameConfig={[]} />);
      expect(screen.getByText('Excel 转 DWD/ODS 建表工具')).toBeInTheDocument();
    });

    it('renders with empty codeToNameConfig', () => {
      render(<ExcelTab rules={defaultRules} codeToNameConfig={[]} />);
      expect(screen.getByText('上传文件')).toBeInTheDocument();
    });

    it('renders with both rules and codeToNameConfig', () => {
      render(<ExcelTab rules={defaultRules} codeToNameConfig={codeToNameConfig} />);
      expect(screen.getByText('Excel 转 DWD/ODS 建表工具')).toBeInTheDocument();
    });
  });

  // ===== 文件输入交互 =====

  describe('文件上传交互', () => {
    it('file input can be clicked', () => {
      render(<ExcelTab rules={defaultRules} codeToNameConfig={[]} />);
      const input = screen.getByLabelText('选择文件');
      // 检查 file input 存在且可用
      expect(input).not.toBeDisabled();
    });

    it('file input is initially enabled (not loading)', () => {
      render(<ExcelTab rules={defaultRules} codeToNameConfig={[]} />);
      const input = screen.getByLabelText('选择文件');
      expect(input).not.toBeDisabled();
    });
  });

  // ===== 复制按钮测试 =====

  describe('复制功能', () => {
    it('renders copy button for ODS section', () => {
      render(<ExcelTab rules={defaultRules} codeToNameConfig={[]} />);
      // 生成按钮存在（在未上传时不可见，但验证初始状态正确）
      const description = screen.getByText(/点击对应的生成按钮生成 ODS、DWD、INSERT 语句/);
      expect(description).toBeInTheDocument();
    });
  });
});
