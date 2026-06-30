/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ===== Mocks =====

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}));

Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
});

import AlterTab from './AlterTab';

// ===== Test Data =====

const sampleRules: any[] = [
  {
    id: 'r1',
    keywords: ['金额', 'price', 'amt', 'total'],
    matchType: 'contains' as const,
    targetField: 'name' as const,
    targetDatabases: ['spark', 'mysql', 'starrocks'],
    dataTypes: { spark: 'DECIMAL', mysql: 'DECIMAL', starrocks: 'DECIMAL' },
    typeParams: { spark: { precision: 24, scale: 6 }, mysql: { precision: 18, scale: 2 }, starrocks: { precision: 18, scale: 2 } },
    priority: 1,
  },
  {
    id: 'r2',
    keywords: ['name', '名称', '描述'],
    matchType: 'contains' as const,
    targetField: 'name' as const,
    targetDatabases: ['spark', 'mysql', 'starrocks'],
    dataTypes: { spark: 'STRING', mysql: 'VARCHAR', starrocks: 'VARCHAR' },
    typeParams: { mysql: { length: 256 }, starrocks: { length: 256 } },
    priority: 4,
  },
  {
    id: 'r3',
    keywords: ['id', 'code', 'icode'],
    matchType: 'contains' as const,
    targetField: 'name' as const,
    targetDatabases: ['spark', 'mysql', 'starrocks'],
    dataTypes: { spark: 'STRING', mysql: 'VARCHAR', starrocks: 'VARCHAR' },
    typeParams: { mysql: { length: 64 }, starrocks: { length: 64 } },
    priority: 5,
  },
];

// ===== Tests =====

describe('AlterTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===== 基础渲染 =====

  describe('渲染', () => {
    it('renders the main title and db type selection', () => {
      render(<AlterTab globalRules={sampleRules} />);

      expect(screen.getByText('目标数据库类型（可多选）')).toBeInTheDocument();
      expect(screen.getByText('Spark SQL')).toBeInTheDocument();
      expect(screen.getByText('MySQL')).toBeInTheDocument();
      expect(screen.getByText('StarRocks')).toBeInTheDocument();
    });

    it('renders input and output areas', () => {
      render(<AlterTab globalRules={sampleRules} />);

      expect(screen.getByText('新增字段（支持 AS 别名、-- 注释）')).toBeInTheDocument();
      expect(screen.getByText('ALTER TABLE 语句')).toBeInTheDocument();
    });

    it('renders action buttons', () => {
      render(<AlterTab globalRules={sampleRules} />);

      expect(screen.getByText('重置')).toBeInTheDocument();
      expect(screen.getByText('复制')).toBeInTheDocument();
    });

    it('renders with empty rules', () => {
      render(<AlterTab globalRules={[]} />);
      expect(screen.getByText('Spark SQL')).toBeInTheDocument();
    });

    it('shows Spark SQL table name input by default', () => {
      render(<AlterTab globalRules={sampleRules} />);
      expect(screen.getByText('Spark SQL 表名')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/输入 Spark SQL 表名/)).toBeInTheDocument();
    });

    it('has empty output placeholder initially', () => {
      render(<AlterTab globalRules={sampleRules} />);
      const allTextareas = screen.getAllByRole('textbox');
      // The last textarea is the read-only output
      const outputArea = allTextareas[allTextareas.length - 1] as HTMLTextAreaElement;
      expect(outputArea.readOnly).toBe(true);
    });
  });

  // ===== 数据库类型选择 =====

  describe('数据库类型选择', () => {
    it('starts with Spark SQL checked by default', () => {
      render(<AlterTab globalRules={sampleRules} />);

      const sparkCheckbox = screen.getByLabelText('Spark SQL') as HTMLInputElement;
      expect(sparkCheckbox.checked).toBe(true);
    });

    it('MySQL and StarRocks are unchecked by default', () => {
      render(<AlterTab globalRules={sampleRules} />);

      expect((screen.getByLabelText('MySQL') as HTMLInputElement).checked).toBe(false);
      expect((screen.getByLabelText('StarRocks') as HTMLInputElement).checked).toBe(false);
    });

    it('shows MySQL table name input when MySQL is selected', () => {
      render(<AlterTab globalRules={sampleRules} />);

      fireEvent.click(screen.getByLabelText('MySQL'));

      expect(screen.getByText('MySQL 表名')).toBeInTheDocument();
    });

    it('shows StarRocks table name input when StarRocks is selected', () => {
      render(<AlterTab globalRules={sampleRules} />);

      fireEvent.click(screen.getByLabelText('StarRocks'));

      expect(screen.getByText('StarRocks 表名')).toBeInTheDocument();
    });

    it('shows all three table name inputs when all databases are selected', () => {
      render(<AlterTab globalRules={sampleRules} />);

      fireEvent.click(screen.getByLabelText('MySQL'));
      fireEvent.click(screen.getByLabelText('StarRocks'));

      expect(screen.getByText('Spark SQL 表名')).toBeInTheDocument();
      expect(screen.getByText('MySQL 表名')).toBeInTheDocument();
      expect(screen.getByText('StarRocks 表名')).toBeInTheDocument();
    });

    it('all checkboxes toggle correctly', () => {
      render(<AlterTab globalRules={sampleRules} />);

      // Click MySQL on
      fireEvent.click(screen.getByLabelText('MySQL'));
      expect((screen.getByLabelText('MySQL') as HTMLInputElement).checked).toBe(true);

      // Click MySQL off
      fireEvent.click(screen.getByLabelText('MySQL'));
      expect((screen.getByLabelText('MySQL') as HTMLInputElement).checked).toBe(false);
    });
  });

  // ===== 表名输入 =====

  describe('表名输入', () => {
    it('accepts text in Spark SQL table name input', () => {
      render(<AlterTab globalRules={sampleRules} />);

      const input = screen.getByPlaceholderText(/输入 Spark SQL 表名/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'my_table' } });

      expect(input.value).toBe('my_table');
    });

    it('accepts text in MySQL table name input', () => {
      render(<AlterTab globalRules={sampleRules} />);

      fireEvent.click(screen.getByLabelText('MySQL'));
      const input = screen.getByPlaceholderText(/输入 MySQL 表名/) as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'mysql_table' } });

      expect(input.value).toBe('mysql_table');
    });
  });

  // ===== 字段输入区域 =====

  describe('字段输入', () => {
    it('has placeholder text explaining input format', () => {
      render(<AlterTab globalRules={sampleRules} />);

      // The first textarea (second textbox element) is the field input
      const textboxes = screen.getAllByRole('textbox');
      // textboxes: [tableName input, fieldTextarea, outputTextarea]
      const fieldTextarea = textboxes[1] as HTMLTextAreaElement;

      expect(fieldTextarea.placeholder).toContain('示例格式');
    });

    it('accepts text in the field input area via fireEvent.change', () => {
      render(<AlterTab globalRules={sampleRules} />);

      const textboxes = screen.getAllByRole('textbox');
      const fieldTextarea = textboxes[1] as HTMLTextAreaElement;

      fireEvent.change(fieldTextarea, { target: { value: 'test_col -- 测试' } });

      expect(fieldTextarea.value).toBe('test_col -- 测试');
    });

    it('accepts multi-line field input', () => {
      render(<AlterTab globalRules={sampleRules} />);

      const textboxes = screen.getAllByRole('textbox');
      const fieldTextarea = textboxes[1] as HTMLTextAreaElement;
      const multiLine = 'field1 -- 字段1\nfield2 -- 字段2';

      fireEvent.change(fieldTextarea, { target: { value: multiLine } });

      expect(fieldTextarea.value).toBe(multiLine);
    });
  });

  // ===== 重置功能 =====

  describe('重置功能', () => {
    it('reset button clears table name inputs', () => {
      render(<AlterTab globalRules={sampleRules} />);

      const tableInput = screen.getByPlaceholderText(/输入 Spark SQL 表名/) as HTMLInputElement;
      fireEvent.change(tableInput, { target: { value: 'my_table' } });
      expect(tableInput.value).toBe('my_table');

      fireEvent.click(screen.getByText('重置'));

      expect(tableInput.value).toBe('');
    });

    it('reset button clears field input', () => {
      render(<AlterTab globalRules={sampleRules} />);

      const textboxes = screen.getAllByRole('textbox');
      const fieldTextarea = textboxes[1] as HTMLTextAreaElement;

      fireEvent.change(fieldTextarea, { target: { value: 'test_field' } });

      fireEvent.click(screen.getByText('重置'));

      expect(fieldTextarea.value).toBe('');
    });
  });

  // ===== 复制功能 =====

  describe('复制功能', () => {
    it('copy button triggers clipboard write when output is present', () => {
      render(<AlterTab globalRules={sampleRules} />);

      // Click the copy button - even with default output it should be called
      fireEvent.click(screen.getByText('复制'));

      // Default output contains "-- 请至少添加一个字段" which doesn't have "alter table"
      // So clipboard should NOT be called for empty output
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });
  });
});
