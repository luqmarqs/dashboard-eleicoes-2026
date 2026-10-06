import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { agregar, type Base, type LinhaAgregada, type Nivel, type PorLocal } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { fmt, pct, titulo } from "../lib/format";
import { DataTable } from "./DataTable";
import { Segmented } from "./ui";

const NIVEIS: { id: Nivel; label: string }[] = [
  { id: "municipio", label: "Por cidade" },
  { id: "bairro", label: "Por bairro" },
  { id: "local", label: "Por escola" },
];

/** Tabelas por cidade / bairro / escola de uma série (candidatura). */
export function Rankings({ base, dados, municipio, nomeArquivo }: {
  base: Base; dados: PorLocal; municipio: string | null; nomeArquivo: string;
}) {
  const [nivel, setNivel] = useState<Nivel>(municipio ? "bairro" : "municipio");
  const niveis = municipio ? NIVEIS.filter((n) => n.id !== "municipio") : NIVEIS;
  const efetivo = municipio && nivel === "municipio" ? "bairro" : nivel;
  const linhas = useMemo(() => agregar(base, dados, efetivo, municipio), [base, dados, efetivo, municipio]);

  const columns = useMemo<ColumnDef<LinhaAgregada, unknown>[]>(() => {
    const cols: ColumnDef<LinhaAgregada, unknown>[] = [
      { id: "rank", header: "#", cell: (c) => c.row.index + 1, enableSorting: false, meta: { numeric: true } },
      {
        id: "nome", accessorKey: "nome",
        header: efetivo === "municipio" ? "Município" : efetivo === "bairro" ? "Bairro (do local de votação)" : "Escola / local",
        cell: (c) => (
          <div className="min-w-0">
            <div className="font-semibold">{efetivo === "local" ? c.row.original.nome : titulo(c.row.original.nome)}</div>
            {efetivo === "local" && <div className="text-xs text-muted">{c.row.original.endereco} · {titulo(c.row.original.bairro ?? "")}</div>}
          </div>
        ),
      },
    ];
    if (efetivo !== "municipio" && !municipio) {
      cols.push({ id: "municipio", accessorKey: "municipio", header: "Município", cell: (c) => titulo(String(c.getValue())) });
    }
    if (efetivo === "local") cols.push({ id: "zona", accessorKey: "zona", header: "Zona", meta: { numeric: true } });
    cols.push(
      { id: "votos", accessorKey: "votos", header: "Votos", cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
      { id: "pct", accessorKey: "pct", header: "% dos válidos", cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
      { id: "validos", accessorKey: "validos", header: "Válidos (todos)", cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    );
    if (efetivo !== "local") cols.push({ id: "locais", accessorKey: "locais", header: "Locais", meta: { numeric: true } });
    cols.push({ id: "secoes", accessorKey: "secoes", header: "Seções", meta: { numeric: true } });
    return cols;
  }, [efetivo, municipio]);

  const exportCols = useMemo<ExportCol<LinhaAgregada>[]>(() => [
    { header: efetivo === "municipio" ? "Município" : efetivo === "bairro" ? "Bairro" : "Local de votação", value: (r) => r.nome },
    ...(efetivo !== "municipio" ? [{ header: "Município", value: (r: LinhaAgregada) => r.municipio }] : []),
    ...(efetivo === "local" ? [
      { header: "Endereço", value: (r: LinhaAgregada) => r.endereco ?? "" },
      { header: "Bairro", value: (r: LinhaAgregada) => r.bairro ?? "" },
      { header: "Zona", value: (r: LinhaAgregada) => r.zona ?? null, type: "number" as const },
    ] : []),
    { header: "Votos", value: (r) => r.votos, type: "number" },
    { header: "% dos válidos", value: (r) => r.pct, type: "percent" },
    { header: "Votos válidos (todos os candidatos)", value: (r) => r.validos, type: "number" },
    { header: "Locais", value: (r) => r.locais, type: "number" },
    { header: "Seções", value: (r) => r.secoes, type: "number" },
  ], [efetivo]);

  return (
    <section className="flex flex-col gap-3" aria-label="Tabelas">
      <Segmented label="Nível da tabela" value={efetivo} onChange={setNivel} options={niveis} />
      <DataTable data={linhas} columns={columns} exportCols={exportCols}
        nomeArquivo={`${nomeArquivo}_${efetivo}`} busca={(r) => `${r.nome} ${r.municipio} ${r.bairro ?? ""}`}
        initialSort={[{ id: "votos", desc: true }]} />
    </section>
  );
}

/** Lista compacta das N áreas mais votadas, ao lado do mapa. */
export function TopLista({ linhas, n, onClick }: { linhas: LinhaAgregada[]; n: number; onClick?: (l: LinhaAgregada) => void }) {
  return (
    <ol className="flex flex-col">
      {linhas.slice(0, n).map((l, i) => (
        <li key={l.key}>
          <button type="button" onClick={() => onClick?.(l)}
            className="grid w-full grid-cols-[24px_1fr_auto] items-baseline gap-2 border-b border-line px-1 py-1.5 text-left hover:bg-accent-soft">
            <span className="num text-right text-xs text-muted">{i + 1}</span>
            <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{titulo(l.nome)}</span>
            <span className="num text-right text-sm">
              {fmt(l.votos)}
              <small className="block text-[11px] text-muted">{pct(l.pct)}</small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
