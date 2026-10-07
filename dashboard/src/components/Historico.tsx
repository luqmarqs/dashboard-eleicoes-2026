import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { agregar, type Base, type Nivel, type PorLocal } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { fmt, pct, titulo } from "../lib/format";
import { source } from "../lib/source";
import { CARGOS, type Candidatura } from "../lib/types";
import { useUf } from "../lib/uf";
import { DataTable } from "./DataTable";
import { Segmented } from "./ui";

interface Linha {
  key: string;
  nome: string;
  municipio: string;
  bairro?: string;
  v26: number;
  val26: number;
  v22: number;
  val22: number;
}

const sinal = (x: number) => (x > 0 ? "+" : "");

export function useHistorico(id: number | undefined) {
  const { uf } = useUf();
  return useQuery({
    queryKey: ["historico", uf, id], queryFn: () => source.historico(id!), enabled: id != null, staleTime: Infinity,
  });
}

/** Comparação da candidatura de 2026 com a de 2022 (mesma pessoa), por cidade, bairro e escola. */
export function Historico({ base, cand, dados, municipio }: {
  base: Base; cand: Candidatura; dados: PorLocal; municipio: string | null;
}) {
  const hist = useHistorico(cand.id);
  const [nivel, setNivel] = useState<Nivel>(municipio ? "bairro" : "municipio");
  const efetivo: Nivel = municipio && nivel === "municipio" ? "bairro" : nivel;

  const r22 = hist.data?.resumo[0];
  const linhas = useMemo<Linha[]>(() => {
    const h = hist.data;
    if (!h || !r22) return [];
    const m22 = new Map<string, { v: number; val: number; mun: string }>();
    h.chave.forEach((k, i) => {
      if (h.nivel[i] !== efetivo || (municipio && h.mun[i] !== municipio)) return;
      m22.set(k, { v: h.votos[i], val: h.validos[i], mun: h.mun[i] });
    });
    const out: Linha[] = agregar(base, dados, efetivo, municipio).map((l) => {
      const o = m22.get(l.key);
      m22.delete(l.key);
      return { key: l.key, nome: l.nome, municipio: l.municipio, bairro: l.bairro, v26: l.votos, val26: l.validos, v22: o?.v ?? 0, val22: o?.val ?? 0 };
    });
    // áreas que só existem em 2022 (ex.: bairro com outra grafia em 2026)
    for (const [k, o] of m22) {
      if (efetivo === "local") continue;
      const nome = efetivo === "bairro" ? k.split("|").slice(1).join("|") : base.munByCd.get(k)?.nome ?? k;
      out.push({ key: k, nome, municipio: base.munByCd.get(o.mun)?.nome ?? o.mun, v26: 0, val26: 0, v22: o.v, val22: o.val });
    }
    return out.sort((a, b) => b.v26 - a.v26 || b.v22 - a.v22);
  }, [hist.data, r22, base, dados, efetivo, municipio]);

  const t26 = useMemo(() => linhas.reduce((a, l) => a + l.v26, 0), [linhas]);
  const t22 = useMemo(() => linhas.reduce((a, l) => a + l.v22, 0), [linhas]);

  const columns = useMemo<ColumnDef<Linha, unknown>[]>(() => [
    { id: "nome", accessorKey: "nome", header: efetivo === "municipio" ? "Município" : efetivo === "bairro" ? "Bairro" : "Escola / local",
      cell: (c) => (
        <div>
          <div className="font-semibold">{efetivo === "local" ? c.row.original.nome : titulo(c.row.original.nome)}</div>
          {efetivo !== "municipio" && !municipio && <div className="text-xs text-muted">{titulo(c.row.original.municipio)}</div>}
        </div>
      ) },
    { id: "v26", accessorKey: "v26", header: "Votos 2026", cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    { id: "v22", accessorKey: "v22", header: "Votos 2022", cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    { id: "dif", accessorFn: (r) => r.v26 - r.v22, header: "Diferença",
      cell: (c) => { const v = Number(c.getValue()); return <span className={v >= 0 ? "text-accent" : "text-danger"}>{sinal(v)}{fmt(v)}</span>; },
      meta: { numeric: true } },
    { id: "var", accessorFn: (r) => (r.v22 ? r.v26 / r.v22 - 1 : null), header: "Variação",
      cell: (c) => { const v = c.getValue() as number | null; return v == null ? "novo" : `${sinal(v)}${pct(v, 0)}`; },
      sortUndefined: "last", meta: { numeric: true } },
    { id: "p26", accessorFn: (r) => (r.val26 ? r.v26 / r.val26 : 0), header: "% válidos 2026", cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
    { id: "p22", accessorFn: (r) => (r.val22 ? r.v22 / r.val22 : 0), header: "% válidos 2022", cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
    { id: "s26", accessorFn: (r) => (t26 ? r.v26 / t26 : 0), header: "% do total 2026", cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
    { id: "s22", accessorFn: (r) => (t22 ? r.v22 / t22 : 0), header: "% do total 2022", cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
  ], [efetivo, municipio, t26, t22]);

  const exportCols: ExportCol<Linha>[] = [
    { header: efetivo === "municipio" ? "Município" : efetivo === "bairro" ? "Bairro" : "Local de votação", value: (r) => r.nome },
    { header: "Município", value: (r) => r.municipio },
    { header: "Votos 2026", value: (r) => r.v26, type: "number" },
    { header: "Votos 2022", value: (r) => r.v22, type: "number" },
    { header: "Diferença", value: (r) => r.v26 - r.v22, type: "number" },
    { header: "Variação", value: (r) => (r.v22 ? r.v26 / r.v22 - 1 : null), type: "percent" },
    { header: "% válidos 2026", value: (r) => (r.val26 ? r.v26 / r.val26 : 0), type: "percent" },
    { header: "% válidos 2022", value: (r) => (r.val22 ? r.v22 / r.val22 : 0), type: "percent" },
    { header: "% do total 2026", value: (r) => (t26 ? r.v26 / t26 : 0), type: "percent" },
    { header: "% do total 2022", value: (r) => (t22 ? r.v22 / t22 : 0), type: "percent" },
  ];

  if (!r22) return null;
  const v26 = dados.total, v22 = r22.votos_total;
  return (
    <section aria-label="Comparação com 2022" className="flex flex-col gap-3">
      <h2 className="display text-2xl">Comparação com 2022</h2>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-lg border border-line bg-panel p-4">
        <div>
          <div className="eyebrow">2022 · {CARGOS[r22.cd_cargo]} · {r22.numero}</div>
          <b className="display num text-2xl">{fmt(v22)}</b> <span className="text-muted">votos</span>
        </div>
        <span className="text-2xl text-muted" aria-hidden>→</span>
        <div>
          <div className="eyebrow">2026 · {CARGOS[cand.cargo]} · {cand.numero}</div>
          <b className="display num text-2xl">{fmt(v26)}</b> <span className="text-muted">votos</span>
        </div>
        <div className="ml-auto text-right">
          <b className={`display num text-2xl ${v26 >= v22 ? "text-accent" : "text-danger"}`}>{sinal(v26 - v22)}{fmt(v26 - v22)}</b>
          <div className="text-sm text-muted">{v22 ? `${sinal(v26 / v22 - 1)}${pct(v26 / v22 - 1, 0)}` : ""} no estado</div>
        </div>
        {r22.cd_cargo !== cand.cargo && (
          <p className="w-full text-xs text-muted">
            Cargos diferentes: a "% dos válidos" de cada ano usa os votos válidos do respectivo cargo ({CARGOS[r22.cd_cargo]} em 2022, {CARGOS[cand.cargo]} em 2026).
          </p>
        )}
      </div>
      <Segmented label="Nível da comparação" value={efetivo} onChange={setNivel}
        options={[
          ...(municipio ? [] : [{ id: "municipio" as Nivel, label: "Por cidade" }]),
          { id: "bairro", label: "Por bairro" }, { id: "local", label: "Por escola" },
        ]} />
      <DataTable data={linhas} columns={columns} exportCols={exportCols}
        nomeArquivo={`${cand.numero}_2022x2026_${efetivo}${municipio ? `_${municipio}` : ""}`}
        busca={(r) => `${r.nome} ${r.municipio}`} initialSort={[{ id: "v26", desc: true }]} />
      <p className="text-xs text-muted">
        2022: dados abertos do TSE (votação por seção e locais de votação de 2022). Escolas de 2022 foram associadas às de 2026 pelo
        nome no mesmo município ou, quando o nome mudou, pela mais próxima até 150 m; 2,3% dos locais de 2022 ficaram sem par
        e entram só nas comparações por cidade e bairro. Bairro é o do local de votação.
      </p>
    </section>
  );
}
