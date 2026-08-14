import type { ReactNode } from 'react';

export type DataTableColumn<T> = {
  align?: 'left' | 'right';
  header: string;
  key: keyof T & string;
  render?: (row: T) => ReactNode;
};

type DataTableProps<T> = {
  bodyId?: string;
  className?: string;
  columns: readonly DataTableColumn<T>[];
  emptyText?: string;
  loading?: boolean;
  rowKey: (row: T) => string;
  rows: readonly T[];
};

export function DataTable<T>({
  bodyId,
  className,
  columns,
  emptyText = '暂无数据',
  loading = false,
  rowKey,
  rows,
}: DataTableProps<T>) {
  return (
    <div className="data-table-wrap">
      <table className={`data-table${className ? ` ${className}` : ''}`}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} data-align={column.align ?? 'left'}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody id={bodyId}>
          {loading && Array.from({ length: 3 }, (_, index) => (
            <tr key={`skeleton-${index}`} data-testid="table-skeleton-row">
              {columns.map((column) => (
                <td key={column.key}><span className="skeleton-line" /></td>
              ))}
            </tr>
          ))}
          {!loading && rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} data-align={column.align ?? 'left'}>
                  {column.render ? column.render(row) : String(row[column.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td className="data-table__empty" colSpan={columns.length}>{emptyText}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
