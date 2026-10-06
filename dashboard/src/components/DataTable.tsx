import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import { exportarCsv, exportarXlsx, type ExportCol } from "../lib/export";
import { normalizar } from "../lib/format";

interface Props<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  exportCols: ExportCol<T>[];
  nomeArquivo: string;
  busca?: (row: T) => string;
  initialSort?: SortingState;
  pageSize?: number;
}

export function DataTable<T>({ data, columns, exportCols, nomeArquivo, busca, initialSort = [], pageSize = 25 }: Props<T>) {
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
            placeholder="Buscar…"
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-1.5"
          />
        )}
        <span className="text-sm text-muted">{linhas.length.toLocaleString("pt-BR")} linhas</span>
        <div className="ml-auto flex gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
            onClick={() => exportarCsv(linhas, exportCols, nomeArquivo)}>CSV</button>
          <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
            onClick={() => void exportarXlsx(linhas, exportCols, nomeArquivo)}>Excel</button>
        </div>
      </div>
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
                        <button type="button" className="inline-flex items-center gap-1" onClick={h.column.getToggleSortingHandler()}
                          aria-label={`Ordenar por ${String(h.column.columnDef.header)}`}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <span className="text-muted">{sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}</span>
                        </button>
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
            onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Anterior</button>
          <span className="num text-muted">{pageIndex + 1} / {table.getPageCount()}</span>
          <button type="button" className="rounded-md border border-line px-2 py-1 disabled:opacity-40"
            onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Próxima</button>
        </div>
      )}
    </div>
  );
}
