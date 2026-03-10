'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, Download, Plus, Trash2, Save, Database } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { DEFAULT_CODE_TO_NAME_SCOPE_KEY } from '@/lib/config-defaults';

export interface ConfigRow {
  id: string;
  tableEnName: string;
  tableChineseName: string;
  tableAlias: string;
  dimTableField: string;
  mainTableField: string;
  extraConditions: string;
  requireFields: string;
}

interface CodeToNameApiResponse {
  data: ConfigRow[];
  version: string | null;
  updatedAt: string | null;
  error?: string;
}

interface CodeToNameConfigProps {
  onDataChange?: (rows: ConfigRow[]) => void;
}

const LEGACY_CODE_TO_NAME_KEY = 'codeToNameConfig';

export default function CodeToNameConfig({ onDataChange }: CodeToNameConfigProps) {
  const { success, error: toastError, warning } = useToast();

  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<ConfigRow>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipAutoSaveRef = useRef(true);
  const versionRef = useRef<string | null>(null);
  const toastHandlersRef = useRef({ success, error: toastError, warning });

  useEffect(() => {
    toastHandlersRef.current = { success, error: toastError, warning };
  }, [success, toastError, warning]);

  const fetchRemoteConfig = useCallback(async (): Promise<CodeToNameApiResponse> => {
    const response = await fetch(
      `/api/config/code-to-name?scopeKey=${encodeURIComponent(DEFAULT_CODE_TO_NAME_SCOPE_KEY)}`,
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || '加载码转名配置失败');
    }
    return response.json();
  }, []);

  const saveRemoteConfig = useCallback(
    async (
      rowsToSave: ConfigRow[],
      options?: {
        silent?: boolean;
        overrideVersion?: string | null;
      },
    ) => {
      setSaving(true);
      try {
        const response = await fetch('/api/config/code-to-name', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scopeKey: DEFAULT_CODE_TO_NAME_SCOPE_KEY,
            data: rowsToSave,
            version: options?.overrideVersion ?? versionRef.current,
            updatedBy: 'web-ui',
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const message = errorData.error || '保存码转名配置失败';
          if (response.status === 409) {
            throw new Error(`CONFLICT:${message}`);
          }
          throw new Error(message);
        }

        const result = (await response.json()) as CodeToNameApiResponse;
        versionRef.current = result.version ?? null;
        const persistedRows = Array.isArray(result.data) ? result.data : rowsToSave;
        onDataChange?.(persistedRows);

        if (!options?.silent) {
          toastHandlersRef.current.success('配置已同步到服务器');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '保存码转名配置失败';
        if (message.startsWith('CONFLICT:')) {
          toastHandlersRef.current.warning('服务器配置已更新，已自动刷新为最新版本');
          try {
            const latest = await fetchRemoteConfig();
            const latestRows = Array.isArray(latest.data) ? latest.data : [];
            skipAutoSaveRef.current = true;
            setRows(latestRows);
            versionRef.current = latest.version ?? null;
            onDataChange?.(latestRows);
          } catch {
            toastHandlersRef.current.error('配置冲突，请刷新后重试');
          }
        } else {
          toastHandlersRef.current.error(message);
        }
      } finally {
        setSaving(false);
      }
    },
    [fetchRemoteConfig, onDataChange],
  );

  useEffect(() => {
    const loadData = async () => {
      try {
        const remote = await fetchRemoteConfig();
        const remoteRows = Array.isArray(remote.data) ? remote.data : [];
        skipAutoSaveRef.current = true;
        setRows(remoteRows);
        versionRef.current = remote.version ?? null;
        onDataChange?.(remoteRows);

        if (!remote.version) {
          const legacyRaw = localStorage.getItem(LEGACY_CODE_TO_NAME_KEY);
          if (legacyRaw) {
            try {
              const legacyParsed = JSON.parse(legacyRaw);
              if (Array.isArray(legacyParsed) && legacyParsed.length > 0) {
                const confirmMigrate = window.confirm('检测到浏览器中的历史码转名配置，是否迁移到服务器？');
                if (confirmMigrate) {
                  skipAutoSaveRef.current = true;
                  setRows(legacyParsed);
                  await saveRemoteConfig(legacyParsed, { silent: true, overrideVersion: null });
                  localStorage.removeItem(LEGACY_CODE_TO_NAME_KEY);
                  toastHandlersRef.current.success('历史码转名配置已迁移到服务器');
                }
              }
            } catch {
              // 忽略无法解析的旧数据
            }
          }
        }
      } catch (error) {
        toastHandlersRef.current.error(error instanceof Error ? error.message : '加载码转名配置失败');
      } finally {
        setLoaded(true);
      }
    };

    void loadData();
  }, [fetchRemoteConfig, onDataChange, saveRemoteConfig]);

  useEffect(() => {
    if (!loaded) return;
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void saveRemoteConfig(rows, { silent: true });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [loaded, rows, saveRemoteConfig]);

  const handleAddRow = () => {
    const newRow: ConfigRow = {
      id: Date.now().toString(),
      tableEnName: '',
      tableChineseName: '',
      tableAlias: '',
      dimTableField: '',
      mainTableField: '',
      extraConditions: '',
      requireFields: '',
    };
    setRows(prev => [...prev, newRow]);
    setEditingId(newRow.id);
    setEditFormData(newRow);
  };

  const handleEdit = (row: ConfigRow) => {
    setEditingId(row.id);
    setEditFormData({ ...row });
  };

  const handleSave = () => {
    if (!editFormData.tableEnName || !editFormData.dimTableField || !editFormData.mainTableField) {
      warning('请填写必填项：表英文名、维表关联字段、主表关联字段');
      return;
    }

    setRows(prev =>
      prev.map(row => (row.id === editingId ? ({ ...editFormData, id: row.id } as ConfigRow) : row)),
    );
    setEditingId(null);
    setEditFormData({});
    success('配置行已更新');
  };

  const handleCancel = () => {
    if (editFormData && editingId && !rows.find(r => r.id === editingId)?.tableEnName) {
      setRows(prev => prev.filter(row => row.id !== editingId));
    }
    setEditingId(null);
    setEditFormData({});
  };

  const handleDelete = (id: string) => {
    setRows(prev => prev.filter(row => row.id !== id));
    success('配置已删除');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const data = event.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        const importedRows: ConfigRow[] = jsonData.map((row, index) => ({
          id: `${Date.now()}_${index}`,
          tableEnName: row['表英文名'] || row.tableEnName || '',
          tableChineseName: row['表中文名'] || row.tableChineseName || '',
          tableAlias: row['表别名'] || row.tableAlias || '',
          dimTableField: row['维表关联字段'] || row.dimTableField || '',
          mainTableField: row['主表关联字段'] || row.mainTableField || '',
          extraConditions: row['额外关联条件'] || row.extraConditions || '',
          requireFields: row['需求字段名'] || row.requireFields || '',
        }));

        setRows(prev => [...prev, ...importedRows]);
        success(`成功导入 ${importedRows.length} 条配置`);
      } catch (error) {
        toastError('导入失败，请确保文件格式正确');
        console.error(error);
      }
    };

    reader.readAsBinaryString(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleExport = () => {
    if (rows.length === 0) {
      warning('没有数据可以导出');
      return;
    }

    const exportData = rows.map(row => ({
      表英文名: row.tableEnName,
      表中文名: row.tableChineseName,
      表别名: row.tableAlias,
      维表关联字段: row.dimTableField,
      主表关联字段: row.mainTableField,
      额外关联条件: row.extraConditions,
      需求字段名: row.requireFields,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '配置');
    XLSX.writeFile(wb, `码转名维表配置_${new Date().toLocaleDateString()}.xlsx`);
  };

  const isEditing = (id: string) => editingId === id;

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle>配置列表</CardTitle>
            <CardDescription>当前共有 {rows.length} 条配置</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleAddRow} className="gap-2">
              <Plus className="w-4 h-4" />
              新增配置
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="gap-2">
              <Upload className="w-4 h-4" />
              导入Excel
            </Button>
            <Button onClick={handleExport} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              导出Excel
            </Button>
            <Button
              onClick={() => void saveRemoteConfig(rows)}
              variant="outline"
              className="gap-2"
              disabled={saving}
            >
              <Save className="w-4 h-4" />
              {saving ? '同步中...' : '同步服务器'}
            </Button>
            {rows.length > 0 && (
              <Button
                onClick={() => {
                  setRows([]);
                  success('所有配置已清空');
                }}
                variant="destructive"
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                清空数据
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleImport}
              className="hidden"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto border rounded-lg">
          <Table>
            <TableHeader className="bg-slate-50 dark:bg-slate-800">
              <TableRow>
                <TableHead className="w-12 text-center font-bold">#</TableHead>
                <TableHead className="font-bold whitespace-nowrap min-w-[150px]">
                  表英文名<span className="text-red-500">*</span>
                </TableHead>
                <TableHead className="font-bold whitespace-nowrap min-w-[120px]">表中文名</TableHead>
                <TableHead className="font-bold whitespace-nowrap min-w-[120px]">表别名</TableHead>
                <TableHead className="font-bold whitespace-nowrap min-w-[150px]">
                  维表关联字段<span className="text-red-500">*</span>
                </TableHead>
                <TableHead className="font-bold whitespace-nowrap min-w-[150px]">
                  主表关联字段<span className="text-red-500">*</span>
                </TableHead>
                <TableHead className="font-bold whitespace-nowrap min-w-[200px]">额外关联条件</TableHead>
                <TableHead className="font-bold whitespace-nowrap min-w-[200px]">需求字段名</TableHead>
                <TableHead className="w-48 text-center font-bold whitespace-nowrap">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-slate-500 dark:text-slate-400">
                    <Database className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p className="text-lg mb-2">暂无配置</p>
                    <p className="text-sm">点击"新增配置"按钮添加第一条配置</p>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, index) => (
                  <TableRow key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <TableCell className="text-center font-medium text-slate-500">{index + 1}</TableCell>
                    <TableCell>
                      {isEditing(row.id) ? (
                        <Input
                          value={editFormData.tableEnName || ''}
                          onChange={e => setEditFormData({ ...editFormData, tableEnName: e.target.value })}
                          placeholder="表英文名"
                          className="min-w-[140px]"
                        />
                      ) : (
                        <span className="font-medium">{row.tableEnName || '-'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing(row.id) ? (
                        <Input
                          value={editFormData.tableChineseName || ''}
                          onChange={e => setEditFormData({ ...editFormData, tableChineseName: e.target.value })}
                          placeholder="表中文名"
                          className="min-w-[110px]"
                        />
                      ) : (
                        <span>{row.tableChineseName || '-'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing(row.id) ? (
                        <Input
                          value={editFormData.tableAlias || ''}
                          onChange={e => setEditFormData({ ...editFormData, tableAlias: e.target.value })}
                          placeholder="表别名"
                          className="min-w-[110px]"
                        />
                      ) : (
                        <span>{row.tableAlias || '-'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing(row.id) ? (
                        <Input
                          value={editFormData.dimTableField || ''}
                          onChange={e => setEditFormData({ ...editFormData, dimTableField: e.target.value })}
                          placeholder="维表关联字段"
                          className="min-w-[140px]"
                        />
                      ) : (
                        <span className="font-medium">{row.dimTableField || '-'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing(row.id) ? (
                        <Input
                          value={editFormData.mainTableField || ''}
                          onChange={e => setEditFormData({ ...editFormData, mainTableField: e.target.value })}
                          placeholder="主表关联字段"
                          className="min-w-[140px]"
                        />
                      ) : (
                        <span className="font-medium">{row.mainTableField || '-'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing(row.id) ? (
                        <Input
                          value={editFormData.extraConditions || ''}
                          onChange={e => setEditFormData({ ...editFormData, extraConditions: e.target.value })}
                          placeholder="额外关联条件，逗号分割"
                          className="min-w-[180px]"
                        />
                      ) : (
                        <span className="text-sm">{row.extraConditions || '-'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {isEditing(row.id) ? (
                        <Input
                          value={editFormData.requireFields || ''}
                          onChange={e => setEditFormData({ ...editFormData, requireFields: e.target.value })}
                          placeholder="需求字段名，逗号分割"
                          className="min-w-[180px]"
                        />
                      ) : (
                        <span className="text-sm">{row.requireFields || '-'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2 justify-center">
                        {isEditing(row.id) ? (
                          <>
                            <Button onClick={handleSave} size="sm" className="gap-1">
                              <Save className="w-3 h-3" />
                              保存
                            </Button>
                            <Button onClick={handleCancel} variant="outline" size="sm">
                              取消
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button onClick={() => handleEdit(row)} variant="outline" size="sm" className="gap-1">
                              <Save className="w-3 h-3" />
                              编辑
                            </Button>
                            <Button onClick={() => handleDelete(row.id)} variant="destructive" size="sm" className="gap-1">
                              <Trash2 className="w-3 h-3" />
                              删除
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
