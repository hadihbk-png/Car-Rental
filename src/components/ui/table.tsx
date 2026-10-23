import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface Column<Row> {
  /** Stable key for React. */
  key: string;
  header: ReactNode;
  /** Renders the cell. (Server-rendered tables can pass functions; client tables too.) */
  cell: (row: Row) => ReactNode;
  align?: "left" | "right" | "center";
  /** Hide on the stacked mobile layout (e.g. redundant ids). */
  hideOnMobile?: boolean;
  /** Visually hide the header text (e.g. an actions column) — still read by screen readers. */
  srOnlyHeader?: boolean;
  className?: string;
}

export interface DataTableProps<Row> {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  getRowKey: (row: Row) => string;
  /** Required accessible caption; visually hidden unless showCaption. */
  caption: string;
  showCaption?: boolean;
  /** Rendered instead of the table when rows is empty (use <EmptyState/>). */
  empty?: ReactNode;
  /** Column whose cell becomes the card title on mobile (default: first column). */
  primaryColumnKey?: string;
  className?: string;
}

const alignClass = { left: "text-left", right: "text-right", center: "text-center" };
const mdAlignClass = { left: "md:text-left", right: "md:text-right", center: "md:text-center" };

/**
 * Semantic table on md+; on small screens every row becomes a card of label/value pairs.
 * Header labels are repeated per cell for the stacked layout (aria-hidden there, since the
 * real <th> association still applies to the cell).
 */
export function DataTable<Row>({
  columns,
  rows,
  getRowKey,
  caption,
  showCaption = false,
  empty,
  primaryColumnKey,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  const primaryKey = primaryColumnKey ?? columns[0]?.key;

  return (
    <div className={cn("md:overflow-x-auto md:rounded-xl md:border md:border-line md:bg-surface md:shadow-card", className)}>
      {/* Explicit roles keep table semantics when the mobile layout changes display values. */}
      <table role="table" className="w-full border-collapse text-sm">
        <caption className={cn(showCaption ? "px-4 py-3 text-left font-semibold text-ink" : "sr-only")}>{caption}</caption>
        <thead role="rowgroup" className="sr-only md:not-sr-only">
          <tr role="row" className="border-b border-line bg-canvas">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                role="columnheader"
                className={cn(
                  "px-4 py-3 text-xs font-semibold tracking-wide whitespace-nowrap text-ink-muted uppercase",
                  alignClass[col.align ?? "left"],
                  col.className,
                )}
              >
                {col.srOnlyHeader ? <span className="sr-only">{col.header}</span> : col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="flex flex-col gap-3 md:table-row-group">
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              role="row"
              className={cn(
                "flex flex-col rounded-xl border border-line bg-surface p-4 shadow-xs",
                "md:table-row md:rounded-none md:border-0 md:border-b md:p-0 md:shadow-none md:last:border-b-0 md:hover:bg-canvas/70",
              )}
            >
              {columns.map((col) => {
                const isPrimary = col.key === primaryKey;
                return (
                  <td
                    key={col.key}
                    role="cell"
                    className={cn(
                      "md:table-cell md:px-4 md:py-3 md:align-middle",
                      isPrimary
                        ? "order-first pb-2 text-base font-semibold text-ink md:text-sm md:font-medium"
                        : "flex items-start justify-between gap-4 border-t border-line/70 py-2 md:border-0",
                      col.hideOnMobile && "hidden",
                      mdAlignClass[col.align ?? "left"],
                      col.className,
                    )}
                  >
                    {!isPrimary && !col.srOnlyHeader && (
                      <span className="text-ink-muted md:hidden" aria-hidden="true">
                        {col.header}
                      </span>
                    )}
                    <span className={cn("min-w-0", !isPrimary && cn("text-right", mdAlignClass[col.align ?? "left"]))}>{col.cell(row)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
