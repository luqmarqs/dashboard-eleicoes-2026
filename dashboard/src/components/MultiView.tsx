import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { agregar, porLocal, useBase, useTotais, useVotos, type Base, type Nivel, type PorLocal } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { fmt, pct, titulo } from "../lib/format";
import { CARGOS, type Candidatura } from "../lib/types";
import { DataTable } from "./DataTable";
import { MapView, type Metrica, type Modo } from "./MapView";
import { TopLista } from "./Rankings";
import { ErrorBox, Loading, MapControls, Segmented, SituacaoBadge, nomeCand } from "./ui";

interface Linha {
  key: string;
  nome: string;
  municipio: string;
  bairro?: string;
  endereco?: string | null;
  porCand: number[];
  soma: number;
  validos: number;
}

/** Comparativo de várias candidaturas (mesmo cargo ou não): mapa com seletor + matriz por nível. */
export function MultiView({ ids, municipio, nomeArquivo, onMunicipio }: {
  ids: number[]; municipio: string | null; nomeArquivo: string; onMunicipio?: (cd: string) => void;
}) {
  const base = useBase();
  const votos = useVotos(ids, municipio);
  const cands = useMemo(() => ids.map((id) => base.data?.candById.get(id)).filter(Boolean) as Candidatura[], [ids, base.data]);
  const cargos = useMemo(() => [...new Set(cands.map((c) => c.cargo))], [cands]);
  const totais = useTotais(cargos.length === 1 ? cargos[0] : cargos[0], municipio);
  const [serie, setSerie] = useState<number | "soma">(ids[0] ?? "soma");
  const [modo, setModo] = useState<Modo>(municipio ? "escolas" : "municipios");
  const [metrica, setMetrica] = useState<Metrica>("pct");
  const [nivel, setNivel] = useState<Nivel>(municipio ? "bairro" : "municipio");

  const porCand = useMemo(() => {
    if (!base.data || !votos.data || !totais.data) return null;
    return cands.map((c) => porLocal(base.data!, votos.data![c.id], totais.data));
  }, [base.data, votos.data, totais.data, cands]);

  const somaPl = useMemo<PorLocal | null>(() => {
    if (!porCand?.length) return null;
    const v = new Float64Array(porCand[0].votos.length);
    for (const p of porCand) for (let i = 0; i < v.length; i++) v[i] += p.votos[i];
    return { votos: v, validos: porCand[0].validos, total: porCand.reduce((a, p) => a + p.total, 0), totalValidos: porCand[0].totalValidos };
  }, [porCand]);

  const atual = serie === "soma" ? somaPl : porCand?.[cands.findIndex((c) => c.id === serie)] ?? somaPl;
  const efetivoNivel: Nivel = municipio && nivel === "municipio" ? "bairro" : nivel;

  const linhas = useMemo<Linha[]>(() => {
    if (!base.data || !porCand || !somaPl) return [];
    const ags = porCand.map((p) => new Map(agregar(base.data!, p, efetivoNivel, municipio).map((l) => [l.key, l])));
    return agregar(base.data, somaPl, efetivoNivel, municipio).map((l) => ({
      key: l.key, nome: l.nome, municipio: l.municipio, bairro: l.bairro, endereco: l.endereco,
      porCand: ags.map((m) => m.get(l.key)?.votos ?? 0), soma: l.votos, validos: l.validos,
    }));
  }, [base.data, porCand, somaPl, efetivoNivel, municipio]);

  const lista = useMemo(
    () => (base.data && atual ? agregar(base.data, atual, municipio ? "bairro" : "municipio", municipio).filter((l) => l.votos > 0) : []),
    [base.data, atual, municipio],
  );

  const columns = useMemo<ColumnDef<Linha, unknown>[]>(() => [
    {
      id: "nome", accessorKey: "nome",
      header: efetivoNivel === "municipio" ? "Município" : efetivoNivel === "bairro" ? "Bairro" : "Escola / local",
      cell: (c) => (
        <div className="min-w-[12rem]">
          <div className="font-semibold">{efetivoNivel === "local" ? c.row.original.nome : titulo(c.row.original.nome)}</div>
          {(efetivoNivel !== "municipio" && !municipio) && <div className="text-xs text-muted">{titulo(c.row.original.municipio)}</div>}
          {efetivoNivel === "local" && <div className="text-xs text-muted">{titulo(c.row.original.bairro ?? "")}</div>}
        </div>
      ),
    },
    ...cands.map((cand, i): ColumnDef<Linha, unknown> => ({
      id: `c${cand.id}`, accessorFn: (r) => r.porCand[i], meta: { numeric: true },
      header: () => (
        <span title={[cand.nomeCompleto, cand.situacao].filter(Boolean).join(" · ")}>
          {cand.numero}<br /><span className="font-normal">{cand.nome}</span>
          {cand.situacao?.startsWith("Eleito") && <><br /><SituacaoBadge c={cand} compacto /></>}
        </span>
      ),
      cell: (c) => fmt(Number(c.getValue())),
    })),
    { id: "soma", accessorKey: "soma", header: "Soma", cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    {
      id: "pct", accessorFn: (r) => (r.validos ? r.soma / r.validos : 0), header: "% dos válidos",
      cell: (c) => pct(Number(c.getValue())), meta: { numeric: true },
    },
    { id: "validos", accessorKey: "validos", header: "Válidos (todos)", cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
  ], [cands, efetivoNivel, municipio]);

  const exportCols = useMemo<ExportCol<Linha>[]>(() => [
    { header: efetivoNivel === "municipio" ? "Município" : efetivoNivel === "bairro" ? "Bairro" : "Local de votação", value: (r) => r.nome },
    { header: "Município", value: (r) => r.municipio },
    ...(efetivoNivel === "local" ? [{ header: "Endereço", value: (r: Linha) => r.endereco ?? "" }, { header: "Bairro", value: (r: Linha) => r.bairro ?? "" }] : []),
    ...cands.map((c, i) => ({
      header: `${c.numero} ${c.nome}${c.situacao?.startsWith("Eleito") ? " (ELEITO)" : ""}`,
      value: (r: Linha) => r.porCand[i], type: "number" as const,
    })),
    { header: "Soma das selecionadas", value: (r) => r.soma, type: "number" },
    { header: "% dos válidos", value: (r) => (r.validos ? r.soma / r.validos : 0), type: "percent" },
    { header: "Votos válidos (todos os candidatos)", value: (r) => r.validos, type: "number" },
  ], [cands, efetivoNivel]);

  if (base.error) return <ErrorBox error={base.error} />;
  if (votos.error) return <ErrorBox error={votos.error} />;
  if (!base.data || !porCand) return <Loading texto="Carregando votos das candidaturas…" />;

  return (
    <div className="flex flex-col gap-4">
      {cargos.length > 1 && (
        <p className="rounded-md border border-line bg-accent-soft px-3 py-2 text-sm">
          Candidaturas de cargos diferentes: a soma e a "% dos válidos" usam os válidos de {CARGOS[cargos[0]]}. Compare de preferência dentro do mesmo cargo.
        </p>
      )}
      <ResumoCands base={base.data} cands={cands} porCand={porCand} municipio={municipio} />
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="serie" className="flex items-center gap-2 text-sm text-muted">
          Camada do mapa
          <select id="serie" value={String(serie)} onChange={(e) => setSerie(e.target.value === "soma" ? "soma" : Number(e.target.value))}
            className="rounded-md border border-line bg-panel px-3 py-1.5 text-ink">
            <option value="soma">Soma das {cands.length} selecionadas</option>
            {cands.map((c) => <option key={c.id} value={c.id}>{nomeCand(c)}</option>)}
          </select>
        </label>
        <MapControls modo={modo} setModo={setModo} metrica={metrica} setMetrica={setMetrica} temMunicipio={!!municipio} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {atual && (
          <MapView base={base.data} dados={atual} municipio={municipio} modo={municipio && modo === "municipios" ? "escolas" : modo}
            metrica={metrica} onMunicipio={onMunicipio}
            destaques={lista.slice(0, 20).map((l, i) => ({ rank: i + 1, nome: titulo(l.nome), lat: l.lat, lon: l.lon }))} />
        )}
        <aside className="min-w-0">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">20 {municipio ? "bairros" : "cidades"} com mais votos</h2>
          <TopLista linhas={lista} n={20} onClick={(l) => { if (!municipio && onMunicipio) onMunicipio(l.key); }} />
        </aside>
      </div>
      <Segmented label="Nível da tabela" value={efetivoNivel} onChange={setNivel}
        options={[
          ...(municipio ? [] : [{ id: "municipio" as Nivel, label: "Por cidade" }]),
          { id: "bairro", label: "Por bairro" }, { id: "local", label: "Por escola" },
        ]} />
      <DataTable data={linhas} columns={columns} exportCols={exportCols} nomeArquivo={`${nomeArquivo}_${efetivoNivel}`}
        busca={(r) => `${r.nome} ${r.municipio} ${r.bairro ?? ""}`} initialSort={[{ id: "soma", desc: true }]} />
    </div>
  );
}

function ResumoCands({ base, cands, porCand, municipio }: {
  base: Base; cands: Candidatura[]; porCand: PorLocal[]; municipio: string | null;
}) {
  const tot = porCand.map((p) => {
    let v = 0, val = 0;
    base.locais.forEach((l) => { if (!municipio || l.mun === municipio) { v += p.votos[l.idx]; val += p.validos[l.idx]; } });
    return { v, val };
  });
  const max = Math.max(1, ...tot.map((t) => t.v));
  return (
    <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
      {cands.map((c, i) => (
        <li key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line py-1">
          <div className="min-w-0">
            <Link to={`/c/${c.id}${municipio ? `?mun=${municipio}` : ""}`} className="font-semibold hover:underline">{nomeCand(c)}</Link>
            <SituacaoBadge c={c} />
            <span className="ml-2 text-xs text-muted">{c.partido} · {CARGOS[c.cargo]}</span>
            <div className="mt-1 h-1.5 rounded-sm bg-accent-soft">
              <div className="h-1.5 rounded-sm bg-accent" style={{ width: `${(100 * tot[i].v) / max}%` }} />
            </div>
          </div>
          <span className="num text-right text-sm">{fmt(tot[i].v)}<small className="block text-[11px] text-muted">{tot[i].val ? pct(tot[i].v / tot[i].val) : "–"}</small></span>
        </li>
      ))}
    </ol>
  );
}
