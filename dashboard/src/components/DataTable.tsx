import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import { exportarCsv, exportarXlsx, type ExportCol } from "../lib/export";
import { fmt, normalizar } from "../lib/format";
import { L } from "../lib/i18n";

interface Props<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  exportCols: ExportCol<T>[];
  nomeArquivo: string;
  busca?: (row: T) => string;
  initialSort?: SortingState;
  pageSize?: number;
  /** Ordenações prontas, mostradas como botões acima da tabela (ex.: "Maior perda"). */
  atalhos?: { label: string; sort: SortingState }[];
}

export function DataTable<T>({ data, columns, exportCols, nomeArquivo, busca, initialSort = [], pageSize = 25, atalhos }: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [filtro, setFiltro] = useState("");
  const table = useReactTable({
    data, columns,
    state: { sorting, globalFilter: filtro },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFiltro,
    globalFilterFn: (row, _id, value: string) => !busca || normalizar(busca(row.original)).includes(normalizar(value)),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });
  const linhas = table.getFilteredRowModel().rows.map((r) => r.original);
  const { pageIndex } = table.getState().pagination;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {busca && (
          <input
            id={`busca-${nomeArquivo}`}
            type="search"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder={L("Buscar…", "Search…")}
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-1.5"
          />
        )}
        <span className="text-sm text-muted">{fmt(linhas.length)} {L("linhas", "rows")}</span>
        <div className="ml-auto flex gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
            onClick={() => exportarCsv(linhas, exportCols, nomeArquivo)}>CSV</button>
          <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
            onClick={() => void exportarXlsx(linhas, exportCols, nomeArquivo)}>Excel</button>
        </div>
      </div>
      {atalhos && atalhos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{L("Ordenar por:", "Sort by:")}</span>
          {atalhos.map((a) => {
            const ativo = JSON.stringify(a.sort) === JSON.stringify(sorting);
            return (
              <button key={a.label} type="button" aria-pressed={ativo}
                onClick={() => { setSorting(a.sort); table.setPageIndex(0); }}
                className={`rounded-full border px-3 py-1 ${ativo ? "border-accent bg-accent text-panel font-semibold" : "border-line hover:bg-accent-soft"}`}>
                {a.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const numeric = (h.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric;
                  return (
                    <th key={h.id} scope="col"
                      className={`sticky top-0 border-b border-line bg-panel px-3 py-2 font-semibold whitespace-nowrap ${numeric ? "text-right" : "text-left"}`}>
                      {h.isPlaceholder ? null : (
                        h.column.getCanSort() ? (
                          <button type="button" className="group inline-flex items-center gap-1" onClick={h.column.getToggleSortingHandler()}
                            title={L("Clique para ordenar; clique de novo para inverter", "Click to sort; click again to reverse")}
                            aria-label={L(`Ordenar por ${String(h.column.columnDef.header)}`, `Sort by ${String(h.column.columnDef.header)}`)}>
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            <span className={sorted ? "text-accent" : "text-muted/60 group-hover:text-muted"} aria-hidden>
                              {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}
                            </span>
                          </button>
                        ) : flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-0 hover:bg-accent-soft">
                {row.getVisibleCells().map((cell) => {
                  const numeric = (cell.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric;
                  return (
                    <td key={cell.id} className={`px-3 py-1.5 ${numeric ? "num text-right whitespace-nowrap" : ""}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button type="button" className="rounded-md border border-line px-2 py-1 disabled:opacity-40"
            onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>{L("Anterior", "Previous")}</button>
          <span className="num text-muted">{pageIndex + 1} / {table.getPageCount()}</span>
          <button type="button" className="rounded-md border border-line px-2 py-1 disabled:opacity-40"
            onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>{L("Próxima", "Next")}</button>
        </div>
      )}
    </div>
  );
}
