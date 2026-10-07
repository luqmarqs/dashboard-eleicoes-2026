import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { agregar, type Base, type LinhaAgregada, type Nivel, type PorLocal } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { fmt, pct, titulo } from "../lib/format";
import { DataTable } from "./DataTable";
import { Segmented } from "./ui";
import { L } from "../lib/i18n";

const NIVEIS = (): { id: Nivel; label: string }[] => [
  { id: "municipio", label: L("Por cidade", "By city") },
  { id: "bairro", label: L("Por bairro", "By neighborhood") },
  { id: "local", label: L("Por escola", "By polling place") },
];

/** Tabelas por cidade / bairro / escola de uma série (candidatura). */
export function Rankings({ base, dados, municipio, nomeArquivo }: {
  base: Base; dados: PorLocal; municipio: string | null; nomeArquivo: string;
}) {
  const [nivel, setNivel] = useState<Nivel>(municipio ? "bairro" : "municipio");
  const niveis = municipio ? NIVEIS().filter((n) => n.id !== "municipio") : NIVEIS();
  const efetivo = municipio && nivel === "municipio" ? "bairro" : nivel;
  const linhas = useMemo(() => agregar(base, dados, efetivo, municipio), [base, dados, efetivo, municipio]);
  // Quanto cada linha representa do total da candidatura no escopo (estado ou município escolhido).
  // Parte de cada linha no total da candidatura no escopo: no estado, ou na cidade escolhida.
  const totalEscopo = useMemo(() => linhas.reduce((a, l) => a + l.votos, 0), [linhas]);
  const rotuloTotal = municipio ? L("% do total na cidade", "% of total in the city") : L("% do total da candidatura", "% of candidate total");

  const columns = useMemo<ColumnDef<LinhaAgregada, unknown>[]>(() => {
    const cols: ColumnDef<LinhaAgregada, unknown>[] = [
      { id: "rank", header: "#", cell: (c) => c.row.index + 1, enableSorting: false, meta: { numeric: true } },
      {
        id: "nome", accessorKey: "nome",
        header: efetivo === "municipio" ? L("Município", "City") : efetivo === "bairro" ? L("Bairro (do local de votação)", "Neighborhood (of polling place)") : L("Escola / local", "Polling place"),
        cell: (c) => (
          <div className="min-w-0">
            <div className="font-semibold">{efetivo === "local" ? c.row.original.nome : titulo(c.row.original.nome)}</div>
            {efetivo === "local" && <div className="text-xs text-muted">{c.row.original.endereco} · {titulo(c.row.original.bairro ?? "")}</div>}
          </div>
        ),
      },
    ];
    if (efetivo !== "municipio" && !municipio) {
      cols.push({ id: "municipio", accessorKey: "municipio", header: L("Município", "City"), cell: (c) => titulo(String(c.getValue())) });
    }
    if (efetivo === "local") cols.push({ id: "zona", accessorKey: "zona", header: L("Zona", "Zone"), meta: { numeric: true } });
    cols.push(
      { id: "votos", accessorKey: "votos", header: L("Votos", "Votes"), cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
      {
        id: "partTotal", accessorFn: (r) => (totalEscopo ? r.votos / totalEscopo : 0), header: rotuloTotal,
        cell: (c) => pct(Number(c.getValue())), meta: { numeric: true },
      },
      { id: "pct", accessorKey: "pct", header: L("% dos válidos", "% of valid votes"), cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
      { id: "validos", accessorKey: "validos", header: L("Válidos (todos)", "Valid votes (all)"), cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    );
    return cols;
  }, [efetivo, municipio, totalEscopo, rotuloTotal]);

  const exportCols = useMemo<ExportCol<LinhaAgregada>[]>(() => [
    { header: efetivo === "municipio" ? L("Município", "City") : efetivo === "bairro" ? L("Bairro", "Neighborhood") : L("Local de votação", "Polling place"), value: (r) => r.nome },
    ...(efetivo !== "municipio" ? [{ header: L("Município", "City"), value: (r: LinhaAgregada) => r.municipio }] : []),
    ...(efetivo === "local" ? [
      { header: L("Endereço", "Address"), value: (r: LinhaAgregada) => r.endereco ?? "" },
      { header: L("Bairro", "Neighborhood"), value: (r: LinhaAgregada) => r.bairro ?? "" },
      { header: L("Zona", "Zone"), value: (r: LinhaAgregada) => r.zona ?? null, type: "number" as const },
    ] : []),
    { header: L("Votos", "Votes"), value: (r) => r.votos, type: "number" },
    { header: rotuloTotal, value: (r) => (totalEscopo ? r.votos / totalEscopo : 0), type: "percent" },
    { header: L("% dos válidos", "% of valid votes"), value: (r) => r.pct, type: "percent" },
    { header: L("Votos válidos (todos os candidatos)", "Valid votes (all candidates)"), value: (r) => r.validos, type: "number" },
  ], [efetivo, totalEscopo, rotuloTotal]);

  return (
    <section className="flex flex-col gap-3" aria-label={L("Tabelas", "Tables")}>
      <Segmented label={L("Nível da tabela", "Table level")} value={efetivo} onChange={setNivel} options={niveis} />
      <DataTable titulo={L(`Votos da candidatura, por ${({ municipio: L("cidade", "city"), bairro: L("bairro", "neighborhood"), local: L("escola", "polling place") } as Record<string, string>)[efetivo]}`, `Candidacy votes, by ${({ municipio: L("cidade", "city"), bairro: L("bairro", "neighborhood"), local: L("escola", "polling place") } as Record<string, string>)[efetivo]}`)} data={linhas} columns={columns} exportCols={exportCols}
        nomeArquivo={`${nomeArquivo}_${efetivo}`} busca={(r) => `${r.nome} ${r.municipio} ${r.bairro ?? ""}`}
        initialSort={[{ id: "votos", desc: true }]} />
    </section>
  );
}

/** Lista compacta das N áreas mais votadas, ao lado do mapa. */
export function TopLista({ linhas, n, onClick }: { linhas: LinhaAgregada[]; n: number; onClick?: (l: LinhaAgregada) => void }) {
  // % de cada área na votação total da candidatura no escopo (estado, ou cidade escolhida)
  const total = linhas.reduce((t, l) => t + l.votos, 0);
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
              <small className="block text-[11px] text-muted" title={L(`${pct(l.pct)} dos válidos`, `${pct(l.pct)} of valid votes`)}>{total ? pct(l.votos / total) : "–"} {L("do total", "of total")}</small>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
