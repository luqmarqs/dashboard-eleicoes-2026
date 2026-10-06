import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DataTable } from "../components/DataTable";
import { LazyMap } from "../components/LazyMap";
import { CandidatePicker, ErrorBox, Loading, MunicipioSelect, Segmented, SituacaoBadge, nomeCand } from "../components/ui";
import { cssRgb, type RGB } from "../lib/colors";
import { porLocal, useBase, useTotais, useVotos, type Base, type PorLocal } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { fmt, pct, titulo } from "../lib/format";
import { CARGOS, type Candidatura } from "../lib/types";

const VENCEU: RGB = [123, 31, 162];
const NAO_VENCEU: RGB = [176, 168, 182];
const FAIXAS = [
  { ate: 0.3, rotulo: "menos de 30%" }, { ate: 0.4, rotulo: "30 a 40%" }, { ate: 0.5, rotulo: "40 a 50%" },
  { ate: 0.6, rotulo: "50 a 60%" }, { ate: Infinity, rotulo: "60% ou mais" },
];

interface Analise {
  pres: PorLocal[];
  iRef: number;
  pc: PorLocal;
  vencedor: Int32Array;
  pcs: { c: Candidatura; pl: PorLocal }[];
}

interface Grupo { rotulo: string; locais: number; vPres: number; valPres: number; vCand: number; valCand: number }
const novoGrupo = (rotulo: string): Grupo => ({ rotulo, locais: 0, vPres: 0, valPres: 0, vCand: 0, valCand: 0 });

function correlacao(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function lerCorrelacao(r: number): string {
  const a = Math.abs(r);
  if (!Number.isFinite(r)) return "sem dados suficientes";
  const forca = a < 0.1 ? "praticamente nenhuma" : a < 0.3 ? "fraca" : a < 0.5 ? "moderada" : "forte";
  return `${forca}${a >= 0.1 ? (r > 0 ? " e positiva" : " e negativa") : ""}`;
}

export function Presidente() {
  const [sp, setSp] = useSearchParams();
  const base = useBase();
  const b = base.data;
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v == null) n.delete(k); else n.set(k, v);
    setSp(n, { replace: true });
  };
  const municipio = sp.get("mun");
  const presCands = useMemo(
    () => (b ? b.candidaturas.filter((c) => c.cargo === 1 && c.tipo === "nominal").sort((x, y) => y.votos - x.votos) : []),
    [b],
  );
  const refId = Number(sp.get("ref") ?? presCands.find((c) => c.numero === 13)?.id ?? presCands[0]?.id);
  const candId = Number(sp.get("c") ?? b?.candidaturasDestaque[0]);
  const ref = b?.candById.get(refId);
  const cand = b?.candById.get(candId);

  // Candidaturas da tabela por município/bairro: as em destaque + a selecionada (se for outra).
  const tabela = useMemo(() => {
    if (!b) return [] as Candidatura[];
    const ds = b.candidaturasDestaque.map((id) => b.candById.get(id)).filter(Boolean) as Candidatura[];
    return cand && !ds.some((d) => d.id === cand.id) ? [...ds, cand] : ds;
  }, [b, cand]);
  const ids = useMemo(() => [...presCands.map((c) => c.id), ...tabela.map((c) => c.id)], [presCands, tabela]);
  const votos = useVotos(ids, municipio);
  const totPres = useTotais(1, municipio);
  const totCand = useTotais(cand?.cargo, municipio);
  const tot6 = useTotais(6, municipio);
  const tot7 = useTotais(7, municipio);

  const analise = useMemo(() => {
    if (!b || !votos.data || !totPres.data || !totCand.data || !tot6.data || !tot7.data || !cand || !ref) return null;
    const totais = { 1: totPres.data, 6: tot6.data, 7: tot7.data, [cand.cargo]: totCand.data } as Record<number, typeof totPres.data>;
    const pcs = tabela.filter((c) => totais[c.cargo]).map((c) => ({ c, pl: porLocal(b, votos.data![c.id], totais[c.cargo]) }));
    const pres = presCands.map((c) => porLocal(b, votos.data![c.id], totPres.data));
    const iRef = presCands.findIndex((c) => c.id === ref.id);
    const pc = porLocal(b, votos.data[cand.id], totCand.data);
    const n = b.locais.length;
    const vencedor = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      let best = -1, bv = 0;
      pres.forEach((p, k) => { if (p.votos[i] > bv) { bv = p.votos[i]; best = k; } });
      vencedor[i] = best;
    }
    return { pres, iRef, pc, vencedor, pcs };
  }, [b, votos.data, totPres.data, totCand.data, tot6.data, tot7.data, presCands, cand, ref, tabela]);

  if (base.error) return <ErrorBox error={base.error} />;
  if (!b) return <Loading />;
  const destaques = b.candidaturasDestaque.map((id) => b.candById.get(id)).filter(Boolean) as Candidatura[];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="eyebrow">Presidente × candidatura</div>
        <h1 className="display text-3xl">
          {cand ? nomeCand(cand) : "?"} onde {ref ? ref.nome : "?"} venceu
        </h1>
        <p className="max-w-3xl text-muted">
          Compara a votação da candidatura nos lugares em que {ref?.nome ?? "a referência"} ficou em 1º lugar para presidente
          (1º turno) com os demais, e conforme cresce a % dele no local de votação.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1 text-sm text-muted">
          Candidatura analisada
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Candidatura" value={String(candId)} onChange={(v) => set("c", v)}
              options={destaques.map((c) => ({ id: String(c.id), label: c.nome }))} />
            <div className="w-72"><CandidatePicker id="pres-cand" base={b} onPick={(c) => set("c", String(c.id))} placeholder="ou outra candidatura…" /></div>
          </div>
        </div>
        <label htmlFor="pres-ref" className="flex flex-col gap-1 text-sm text-muted">Referência para presidente
          <select id="pres-ref" value={refId} onChange={(e) => set("ref", e.target.value)}
            className="rounded-md border border-line bg-panel px-3 py-1.5 text-ink">
            {presCands.map((c) => <option key={c.id} value={c.id}>{c.numero} · {c.nome}</option>)}
          </select>
        </label>
        <MunicipioSelect base={b} value={municipio} onChange={(cd) => set("mun", cd)} id="mun-pres" />
      </div>

      {votos.error && <ErrorBox error={votos.error} />}
      {!analise || !cand || !ref ? <Loading texto="Cruzando com a votação para presidente…" /> : (
        <Conteudo base={b} cand={cand} ref_={ref} municipio={municipio} analise={analise}
          presCands={presCands} onMunicipio={(cd) => set("mun", cd)} />
      )}
    </div>
  );
}

function Conteudo({ base, cand, ref_, municipio, analise, presCands, onMunicipio }: {
  base: Base; cand: Candidatura; ref_: Candidatura; municipio: string | null;
  analise: Analise;
  presCands: Candidatura[]; onMunicipio: (cd: string) => void;
}) {
  const { pres, iRef, pc, vencedor } = analise;
  const pr = pres[iRef];
  const locais = base.locais.filter((l) => (!municipio || l.mun === municipio) && pr.validos[l.idx] > 0);

  const grupos = [novoGrupo(`${ref_.nome} venceu`), novoGrupo(`${ref_.nome} não venceu`)];
  const faixas = FAIXAS.map((f) => novoGrupo(f.rotulo));
  let totCand = 0, totVal = 0;
  const xs: number[] = [], ys: number[] = [];
  for (const l of locais) {
    const i = l.idx;
    const g = grupos[vencedor[i] === iRef ? 0 : 1];
    const share = pr.votos[i] / pr.validos[i];
    const f = faixas[FAIXAS.findIndex((x) => share < x.ate)];
    for (const x of [g, f]) {
      x.locais++; x.vPres += pr.votos[i]; x.valPres += pr.validos[i]; x.vCand += pc.votos[i]; x.valCand += pc.validos[i];
    }
    totCand += pc.votos[i]; totVal += pc.validos[i];
    if (pc.validos[i] > 0) { xs.push(share); ys.push(pc.votos[i] / pc.validos[i]); }
  }
  const r = correlacao(xs, ys);
  const [gv, gn] = grupos;
  const razao = gn.valCand && gv.valCand ? (gv.vCand / gv.valCand) / (gn.vCand / gn.valCand) : NaN;

  return (
    <>
      <section aria-label="Resumo" className="rounded-lg border border-line bg-panel p-5">
        <p className="text-lg">
          Onde {ref_.nome} venceu, {cand.nome} teve <b className="num">{pct(gv.valCand ? gv.vCand / gv.valCand : 0)}</b> dos
          válidos para {CARGOS[cand.cargo]}; nos demais lugares, <b className="num">{pct(gn.valCand ? gn.vCand / gn.valCand : 0)}</b>
          {Number.isFinite(razao) && <> ({razao >= 1 ? `${razao.toFixed(1).replace(".", ",")}× mais` : `${(1 / razao).toFixed(1).replace(".", ",")}× menos`})</>}.
          {" "}{pct(totCand ? gv.vCand / totCand : 0, 0)} dos votos de {cand.nome} vieram dos locais vencidos por {ref_.nome}, que reúnem{" "}
          {pct(totVal ? gv.valCand / totVal : 0, 0)} dos votos válidos do cargo. Correlação entre as duas porcentagens por local:{" "}
          <b className="num">{Number.isFinite(r) ? r.toFixed(2).replace(".", ",") : "–"}</b> ({lerCorrelacao(r)}).
        </p>
        <p className="mt-2 text-xs text-muted">
          Dados agregados por local de votação: mostram onde as votações coincidem, não que sejam os mesmos eleitores.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <TabelaGrupos titulo={`Onde ${ref_.nome} venceu`} grupos={grupos} cand={cand} ref_={ref_} totCand={totCand} totVal={totVal} />
        <TabelaGrupos titulo={`Pela % de ${ref_.nome} no local de votação`} grupos={faixas} cand={cand} ref_={ref_} totCand={totCand} totVal={totVal} />
      </div>

      <section aria-label="Mapa" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: cssRgb(VENCEU) }} />{ref_.nome} venceu no local</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: cssRgb(NAO_VENCEU) }} />outro candidato venceu</span>
          <span className="text-muted">tamanho do círculo = votos de {cand.nome}</span>
          <Link className="ml-auto text-accent" to={`/dobrada?a=${ref_.id}&b=${cand.id}${municipio ? `&mun=${municipio}` : ""}`}>
            Ver o cruzamento em 9 classes (dobrada) →
          </Link>
        </div>
        <LazyMap base={base} dados={pc} municipio={municipio} modo="escolas" metrica="votos" rotuloSerie={`votos de ${cand.nome}`}
          corPorLocal={(idx) => (vencedor[idx] < 0 ? null : vencedor[idx] === iRef ? VENCEU : NAO_VENCEU)} onMunicipio={onMunicipio} />
      </section>

      <TabelaAreas base={base} ref_={ref_} municipio={municipio} analise={analise} presCands={presCands} />
    </>
  );
}

function TabelaGrupos({ titulo: t, grupos, cand, ref_, totCand, totVal }: {
  titulo: string; grupos: Grupo[]; cand: Candidatura; ref_: Candidatura; totCand: number; totVal: number;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="display text-lg">{t}</h2>
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2 text-right">Locais</th>
              <th className="px-3 py-2 text-right">{ref_.nome}</th>
              <th className="px-3 py-2 text-right">{cand.nome}<SituacaoBadge c={cand} compacto /></th>
              <th className="px-3 py-2 text-right" title={`Parte dos votos de ${cand.nome} que veio deste grupo`}>parte dos votos</th>
              <th className="px-3 py-2 text-right" title="Parte dos votos válidos do cargo neste grupo">parte do eleitorado</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <tr key={g.rotulo} className="border-b border-line last:border-0">
                <th scope="row" className="px-3 py-1.5 text-left font-semibold">{g.rotulo}</th>
                <td className="num px-3 py-1.5 text-right">{fmt(g.locais)}</td>
                <td className="num px-3 py-1.5 text-right">{g.valPres ? pct(g.vPres / g.valPres, 1) : "–"}</td>
                <td className="num px-3 py-1.5 text-right font-semibold">{g.valCand ? pct(g.vCand / g.valCand) : "–"}</td>
                <td className="num px-3 py-1.5 text-right">{totCand ? pct(g.vCand / totCand, 0) : "–"}</td>
                <td className="num px-3 py-1.5 text-right">{totVal ? pct(g.valCand / totVal, 0) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">% dos votos válidos de cada cargo. "{cand.nome}": {CARGOS[cand.cargo]}.</p>
    </section>
  );
}

interface LinhaArea {
  key: string; nome: string; vencedor: string; refVenceu: boolean; vRef: number; pRef: number; locais: number;
  vCand: number; pCand: number;
}

/** Uma tabela por candidatura (as em destaque + a selecionada), por município ou bairro. */
function TabelaAreas({ base, ref_, municipio, analise, presCands }: {
  base: Base; ref_: Candidatura; municipio: string | null; analise: Analise; presCands: Candidatura[];
}) {
  return (
    <>
      {analise.pcs.map(({ c, pl }) => (
        <TabelaArea key={c.id} base={base} cand={c} pl={pl} ref_={ref_} municipio={municipio} analise={analise}
          presCands={presCands} />
      ))}
    </>
  );
}

function TabelaArea({ base, cand, pl, ref_, municipio, analise, presCands }: {
  base: Base; cand: Candidatura; pl: PorLocal; ref_: Candidatura; municipio: string | null; analise: Analise;
  presCands: Candidatura[];
}) {
  const nivel = municipio ? "bairro" : "municipio";
  const linhas = useMemo<LinhaArea[]>(() => {
    const { pres, iRef } = analise;
    const m = new Map<string, { nome: string; locais: number; pv: number[]; valP: number; vC: number; valC: number }>();
    for (const l of base.locais) {
      if (municipio && l.mun !== municipio) continue;
      const key = nivel === "municipio" ? l.mun : l.bairro;
      const a = m.get(key) ?? { nome: nivel === "municipio" ? l.munNome : l.bairro, locais: 0, pv: pres.map(() => 0), valP: 0, vC: 0, valC: 0 };
      a.locais++;
      pres.forEach((p, k) => { a.pv[k] += p.votos[l.idx]; });
      a.valP += pres[iRef].validos[l.idx];
      a.vC += pl.votos[l.idx];
      a.valC += pl.validos[l.idx];
      m.set(key, a);
    }
    return [...m.entries()].map(([key, a]) => {
      const kv = a.pv.indexOf(Math.max(...a.pv));
      return {
        key, nome: a.nome, vencedor: presCands[kv]?.nome ?? "–", refVenceu: kv === iRef,
        vRef: a.pv[iRef], pRef: a.valP ? a.pv[iRef] / a.valP : 0, locais: a.locais,
        vCand: a.vC, pCand: a.valC ? a.vC / a.valC : 0,
      };
    }).sort((x, y) => y.vCand - x.vCand);
  }, [base, analise, pl, municipio, nivel, presCands]);
  // total da candidatura no escopo (estado, ou cidade escolhida)
  const totalCand = useMemo(() => linhas.reduce((t, l) => t + l.vCand, 0), [linhas]);

  const columns = useMemo<ColumnDef<LinhaArea, unknown>[]>(() => [
    { id: "nome", accessorKey: "nome", header: nivel === "municipio" ? "Município" : "Bairro (do local de votação)",
      cell: (c) => <span className="font-semibold">{titulo(String(c.getValue()))}</span> },
    { id: "vencedor", accessorKey: "vencedor", header: "Venceu p/ presidente",
      cell: (c) => <span className={c.row.original.refVenceu ? "font-semibold text-accent" : ""}>{String(c.getValue())}</span> },
    { id: "vRef", accessorKey: "vRef", header: `Votos ${ref_.nome}`, cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    { id: "pRef", accessorKey: "pRef", header: `% ${ref_.nome}`, cell: (c) => pct(Number(c.getValue()), 1), meta: { numeric: true } },
    { id: "vCand", accessorKey: "vCand", header: `Votos ${cand.nome}`, cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    { id: "pCand", accessorKey: "pCand", header: `% ${cand.nome}`, cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
    { id: "partTotal", accessorFn: (r) => (totalCand ? r.vCand / totalCand : 0),
      header: municipio ? `% do total de ${cand.nome} na cidade` : `% do total de ${cand.nome}`,
      cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
    { id: "locais", accessorKey: "locais", header: "Locais", meta: { numeric: true } },
  ], [nivel, ref_, cand, totalCand, municipio]);
  const exportCols: ExportCol<LinhaArea>[] = [
    { header: nivel === "municipio" ? "Município" : "Bairro", value: (r) => r.nome },
    { header: "Venceu para presidente (1º turno)", value: (r) => r.vencedor },
    { header: `Votos ${ref_.numero} ${ref_.nome}`, value: (r) => r.vRef, type: "number" },
    { header: `% ${ref_.nome} (válidos)`, value: (r) => r.pRef, type: "percent" },
    { header: `Votos ${cand.numero} ${cand.nome}`, value: (r) => r.vCand, type: "number" },
    { header: `% ${cand.nome} (válidos ${CARGOS[cand.cargo]})`, value: (r) => r.pCand, type: "percent" },
    { header: municipio ? `% do total de ${cand.nome} na cidade` : `% do total de ${cand.nome}`,
      value: (r) => (totalCand ? r.vCand / totalCand : 0), type: "percent" },
    { header: "Locais de votação", value: (r) => r.locais, type: "number" },
  ];
  return (
    <section className="flex flex-col gap-2">
      <h2 className="display text-lg">
        {cand.nome} <span className="text-muted">({CARGOS[cand.cargo]})</span> · por {nivel === "municipio" ? "município" : "bairro"}
      </h2>
      <DataTable data={linhas} columns={columns} exportCols={exportCols}
        nomeArquivo={`presidente_${ref_.numero}_x_${cand.numero}${municipio ? `_${municipio}` : ""}`}
        busca={(r) => r.nome} initialSort={[{ id: "vCand", desc: true }]} />
    </section>
  );
}
