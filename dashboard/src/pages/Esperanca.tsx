import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "../components/DataTable";
import { LazyMap } from "../components/LazyMap";
import { ErrorBox, Loading, Segmented } from "../components/ui";
import { cssRgb, prefersDark, type RGB } from "../lib/colors";
import { useBase, useTotais, useVotos, type Base, type PorLocal } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { dec, fmt, pct, titulo } from "../lib/format";
import { L } from "../lib/i18n";
import { CARGOS, type Candidatura, type TotaisCols, type VotosCols } from "../lib/types";
import { MOBILIZACAO, NOME_FAIXA, agrega, linha, nossasDaUf, useBaseCandidatura, type Faixa, type Linha, type LinhaNossa, type Terr } from "../lib/atuacao";
import { useUf } from "../lib/uf";

/*
 * Ainda há esperança: onde Lula foi bem votado e a abstenção foi alta, por cidade e bairro, para priorizar a virada no
 * 2º turno. Modelo simples e declarado: se uma parcela dos abstencionistas de um território votar como quem votou ali,
 * o saldo líquido para Lula é abstenções × (válidos/comparecimento) × (Lula − adversário). Prioridade = esse saldo.
 */

const RAMPA = () => (prefersDark()
  ? ["#3a2f45", "#5a3f75", "#7a4f9a", "#9a66c0", "#c08ce6"]
  : ["#efe6f5", "#d5b8e8", "#b98ad6", "#8e4fc0", "#6a2399"]).map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as RGB);

export function Esperanca() {
  const base = useBase();
  const lula = base.data?.candidaturas.find((c) => c.cargo === 1 && c.numero === 13);
  const adv = base.data?.candidaturas.filter((c) => c.cargo === 1 && c.tipo === "nominal" && c.numero !== 13)
    .sort((a, b) => (Number(b.situacao === "2º turno") - Number(a.situacao === "2º turno")) || b.votos - a.votos)[0];
  const votos = useVotos(lula && adv ? [lula.id, adv.id] : []);
  const totais = useTotais(1);
  if (base.error) return <ErrorBox error={base.error} />;
  if (votos.error) return <ErrorBox error={votos.error} />;
  if (totais.error) return <ErrorBox error={totais.error} />;
  if (!base.data || !votos.data || !totais.data || !lula || !adv) return <Loading />;
  return <Painel base={base.data} lula={lula} adv={adv} votos={votos.data} totais={totais.data} />;
}

function Painel({ base, lula, adv, votos, totais }: { base: Base; lula: Candidatura; adv: Candidatura; votos: Record<number, VotosCols>; totais: TotaisCols }) {
  const { info, uf } = useUf();
  const vazio = { local: [], votos: [] };
  const vl = votos[lula.id] ?? vazio, va = votos[adv.id] ?? vazio;
  const nomeAdv = titulo(adv.nome);

  // locais (unidade mínima) para o cálculo da meta
  const porLocal = useMemo(() => {
    const m = new Map<number, Terr>();
    totais.local.forEach((id, i) => m.set(id, { chave: String(id), cidade: "", cd: "", locais: 1, aptos: totais.aptos[i], comp: totais.comparecimento[i], validos: totais.validos[i], lula: 0, adv: 0 }));
    vl.local.forEach((id, i) => { const t = m.get(id); if (t) t.lula += vl.votos[i]; });
    va.local.forEach((id, i) => { const t = m.get(id); if (t) t.adv += va.votos[i]; });
    return [...m.values()];
  }, [totais, vl, va]);
  const estado = useMemo(() => porLocal.reduce((a, t) => ({ ...a, aptos: a.aptos + t.aptos, comp: a.comp + t.comp, validos: a.validos + t.validos, lula: a.lula + t.lula, adv: a.adv + t.adv }),
    { chave: uf, cidade: info.nome, cd: "", locais: porLocal.length, aptos: 0, comp: 0, validos: 0, lula: 0, adv: 0 } as Terr), [porLocal, uf, info]);
  const medianaAbst = useMemo(() => {
    const xs = porLocal.filter((t) => t.aptos).map((t) => (t.aptos - t.comp) / t.aptos).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  }, [porLocal]);

  const cidades = useMemo(() => [...agrega(base, totais, vl, va, false).values()].map((t) => linha(t, medianaAbst)), [base, totais, vl, va, medianaAbst]);
  const bairros = useMemo(() => [...agrega(base, totais, vl, va, true).values()].filter((t) => t.aptos >= 500).map((t) => linha(t, medianaAbst)), [base, totais, vl, va, medianaAbst]);

  // meta: quanto da abstenção nos locais onde Lula venceu fecha a diferença
  const E = linha(estado, medianaAbst);
  const dif = estado.adv - estado.lula; // > 0: Lula atrás
  const saldoTotal = porLocal.reduce((a, t) => { const x = linha(t, medianaAbst); return x.margem > 0 ? a + x.saldo / MOBILIZACAO : a; }, 0);
  const abstLula = porLocal.reduce((a, t) => (t.lula > t.adv ? a + t.aptos - t.comp : a), 0);
  const precisa = dif > 0 && saldoTotal > 0 ? dif / saldoTotal : null;

  const positivos = cidades.filter((c) => c.saldo > 0).sort((a, b) => b.saldo - a.saldo);
  const somaPos = positivos.reduce((a, c) => a + c.saldo, 0);
  const top5 = positivos.slice(0, 5);
  const top5Share = somaPos ? top5.reduce((a, c) => a + c.saldo, 0) / somaPos : 0;
  const capital = [...cidades].sort((a, b) => b.aptos - a.aptos)[0];
  const bairrosCap = bairros.filter((b) => b.cd === capital?.cd && b.saldo > 0).sort((a, b) => b.saldo - a.saldo).slice(0, 5);
  const disputa = cidades.filter((c) => c.faixa === "disputar").sort((a, b) => b.abst - a.abst).slice(0, 5);
  const faixas = (["mobilizar", "disputar", "conter"] as Faixa[]).map((f) => ({ f, n: cidades.filter((c) => c.faixa === f).length, abst: cidades.filter((c) => c.faixa === f).reduce((a, c) => a + c.abst, 0) }));

  const leitura: ReactNode[] = [];
  leitura.push(L(
    <><b>Ponto de partida:</b> Lula {pct(E.sL, 1)} × {nomeAdv} {pct(E.sA, 1)} dos válidos no 1º turno {dif > 0 ? <>({fmt(dif)} votos atrás)</> : <>({fmt(-dif)} votos à frente)</>}. Abstenção de {pct(E.taxaAbst, 1)}: {fmt(E.abst)} eleitores não votaram.</>,
    <><b>Starting point:</b> Lula {pct(E.sL, 1)} × {nomeAdv} {pct(E.sA, 1)} of valid votes in the 1st round {dif > 0 ? <>({fmt(dif)} votes behind)</> : <>({fmt(-dif)} votes ahead)</>}. Abstention {pct(E.taxaAbst, 1)}: {fmt(E.abst)} voters stayed home.</>));
  leitura.push(precisa == null
    ? L(<><b>A meta:</b> Lula já está à frente no estado; a tarefa é ampliar e proteger a vantagem trazendo de volta parte dos {fmt(abstLula)} abstencionistas dos locais onde ele venceu.</>,
      <><b>The goal:</b> Lula already leads in the state; the task is to widen and protect the lead by bringing back part of the {fmt(abstLula)} abstainers in the polling places he won.</>)
    : precisa <= 1
      ? L(<><b>A meta:</b> nos locais de votação em que Lula venceu, {fmt(abstLula)} eleitores se abstiveram. Se <b>{pct(precisa, 0)}</b> deles votarem como os vizinhos votaram, a diferença no estado fecha.</>,
        <><b>The goal:</b> in the polling places Lula won, {fmt(abstLula)} voters abstained. If <b>{pct(precisa, 0)}</b> of them vote like their neighbours did, the statewide gap closes.</>)
      : L(<><b>A meta:</b> mesmo trazendo todos os {fmt(abstLula)} abstencionistas dos locais em que Lula venceu, o saldo cobre {pct(1 / precisa, 0)} da diferença. A virada exige mobilização somada a persuasão nas cidades em disputa.</>,
        <><b>The goal:</b> even bringing back all {fmt(abstLula)} abstainers in the places Lula won covers {pct(1 / precisa, 0)} of the gap. Turning it around needs mobilization plus persuasion in contested cities.</>));
  if (top5.length) leitura.push(L(
    <><b>Prioridade 1 (mobilizar):</b> {top5.map((c) => c.cidade).join(", ")} concentram {pct(top5Share, 0)} do saldo potencial do estado. Cada 10% de abstencionistas que votam nelas rendem {fmt(Math.round(top5.reduce((a, c) => a + c.saldo, 0)))} votos líquidos para Lula.</>,
    <><b>Priority 1 (mobilize):</b> {top5.map((c) => c.cidade).join(", ")} hold {pct(top5Share, 0)} of the state's potential. Every 10% of abstainers who turn out there yields {fmt(Math.round(top5.reduce((a, c) => a + c.saldo, 0)))} net votes for Lula.</>));
  if (bairrosCap.length) leitura.push(L(
    <><b>Em {capital.cidade}:</b> os bairros com maior saldo são {bairrosCap.map((b) => `${b.bairro} (${fmt(Math.round(b.saldo))})`).join(", ")}. Porta a porta, transporte e mutirão de título/comparecimento nesses territórios.</>,
    <><b>In {capital.cidade}:</b> the neighbourhoods with the largest potential are {bairrosCap.map((b) => `${b.bairro} (${fmt(Math.round(b.saldo))})`).join(", ")}. Door-to-door, transport and turnout drives there.</>));
  if (disputa.length) leitura.push(L(
    <><b>Prioridade 2 (disputar):</b> cidades com margem de até 10 p.p. e muita abstenção: {disputa.map((c) => `${c.cidade} (${c.margem >= 0 ? "+" : ""}${dec(c.margem * 100, 1)} p.p.)`).join(", ")}. Aqui mobilizar não basta: precisa de persuasão (economia, Bolsa Família, salário mínimo) e presença de lideranças locais.</>,
    <><b>Priority 2 (contest):</b> cities within 10 pp and high abstention: {disputa.map((c) => `${c.cidade} (${c.margem >= 0 ? "+" : ""}${dec(c.margem * 100, 1)} pp)`).join(", ")}. Mobilization alone is not enough: persuasion (economy, cash transfers, minimum wage) and local leaders are needed.</>));
  leitura.push(L(
    <><b>Não gastar energia em:</b> {faixas[2].n} cidades onde {nomeAdv} venceu por mais de 10 p.p. (faixa "conter"): mobilizar ali aumenta o saldo dele. Comunicação defensiva, não campanha de comparecimento.</>,
    <><b>Don't spend energy on:</b> {faixas[2].n} cities where {nomeAdv} won by more than 10 pp ("contain" band): turnout drives there help him. Defensive messaging, not turnout campaigns.</>));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="eyebrow">{L(`Estratégia de virada · ${info.nome} · 2º turno presidencial`, `Turnaround strategy · ${info.nome} · presidential runoff`)}</div>
        <h1 className="display text-4xl md:text-5xl">{L("Ainda há esperança", "There is still hope")}</h1>
      </header>

      <section aria-label={L("Leitura", "Reading")} className="rounded-lg border-2 border-accent/60 bg-panel p-4">
        <h2 className="eyebrow mb-2 text-accent">{L("Plano de virada", "Turnaround plan")}</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">{leitura.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <p className="mt-2 text-xs text-muted">
          {L(`Modelo: saldo potencial = ${pct(MOBILIZACAO, 0)} dos abstencionistas × (válidos ÷ comparecimento) × (Lula − ${nomeAdv}), supondo que quem passa a votar vota como quem já votou no mesmo território. É uma régua para priorizar, não uma previsão: abstencionistas costumam ser mais pobres e mais jovens, o que tende a favorecer Lula, mas não há dado individual. Faixas: "mobilizar" = Lula à frente (≥10 p.p., ou à frente e com abstenção acima da mediana dos locais); "disputar" = margem de até 10 p.p.; "conter" = ${nomeAdv} à frente por mais de 10 p.p.`,
            `Model: potential = ${pct(MOBILIZACAO, 0)} of abstainers × (valid ÷ turnout) × (Lula − ${nomeAdv}), assuming new voters vote like those who already voted in the same territory. A yardstick for prioritising, not a forecast: abstainers tend to be poorer and younger, which tends to favour Lula, but there is no individual-level data. Bands: "mobilize" = Lula ahead (≥10 pp, or ahead with abstention above the polling-place median); "contest" = within 10 pp; "contain" = ${nomeAdv} ahead by more than 10 pp.`)}
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {faixas.map(({ f, n, abst }) => (
          <div key={f} className="rounded-lg border border-line bg-panel p-3">
            <div className="eyebrow">{NOME_FAIXA(f)}</div>
            <div className="num text-2xl font-bold">{fmt(n)} <span className="text-sm font-normal text-muted">{L("cidades", "cities")}</span></div>
            <div className="text-xs text-muted">{fmt(abst)} {L("abstenções", "abstentions")}</div>
          </div>
        ))}
      </div>

      <Mapa base={base} cidades={cidades} />
      <TabelaTerr titulo={L(`Prioridades por cidade — saldo potencial para Lula com ${pct(MOBILIZACAO, 0)} de mobilização`, `Priorities by city — potential net votes for Lula with ${pct(MOBILIZACAO, 0)} turnout gain`)}
        linhas={cidades} nomeAdv={nomeAdv} arquivo="esperanca_cidades" />
      <TabelaTerr titulo={L("Prioridades por bairro (todas as cidades; bairros com 500+ eleitores)", "Priorities by neighbourhood (all cities; neighbourhoods with 500+ voters)")}
        linhas={bairros} nomeAdv={nomeAdv} arquivo="esperanca_bairros" bairro />

      <Nossas base={base} uf={uf} bairros={bairros} />
    </div>
  );
}

function Mapa({ base, cidades }: { base: Base; cidades: Linha[] }) {
  const rampa = RAMPA();
  const porCd = useMemo(() => new Map(cidades.map((c) => [c.cd, c])), [cidades]);
  const cortes = useMemo(() => {
    const xs = cidades.filter((c) => c.saldo > 0).map((c) => c.saldo).sort((a, b) => a - b);
    const q = (p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? 0;
    return [q(0.5), q(0.75), q(0.9), q(0.97)];
  }, [cidades]);
  const cor = useCallback((cd: string): RGB | null => {
    const c = porCd.get(cd);
    if (!c) return null;
    if (c.saldo <= 0) return null;
    const i = cortes.filter((x) => c.saldo > x).length;
    return rampa[i];
  }, [porCd, cortes, rampa]);
  const info = useCallback(({ municipio }: { municipio?: string }) => {
    const c = municipio ? porCd.get(municipio) : undefined;
    return c ? L(`Saldo potencial ${fmt(Math.round(c.saldo))} · abstenção ${pct(c.taxaAbst, 1)} · Lula ${pct(c.sL, 1)}`, `Potential ${fmt(Math.round(c.saldo))} · abstention ${pct(c.taxaAbst, 1)} · Lula ${pct(c.sL, 1)}`) : null;
  }, [porCd]);
  const vazio = useMemo<PorLocal>(() => ({ votos: new Float64Array(base.locais.length), validos: new Float64Array(base.locais.length), total: 0, totalValidos: 0 }), [base]);
  return (
    <section aria-label={L("Mapa de prioridades", "Priority map")} className="flex flex-col gap-2">
      <h2 className="display text-2xl">{L("Onde está o voto a buscar", "Where the votes are")}</h2>
      <LazyMap base={base} dados={vazio} municipio={null} modo="municipios" metrica="pct" corPorMunicipio={cor} infoExtra={info} rotuloSerie={L("votos", "votes")} altura="min(62vh, 620px)" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label={L("Legenda", "Legend")}>
        {[L("até a mediana", "up to median"), L("mediana–p75", "median–p75"), "p75–p90", "p90–p97", L("top 3%", "top 3%")].map((t, i) => (
          <span key={t} className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm" style={{ background: cssRgb(rampa[i]) }} />{t}</span>
        ))}
        <span>{L("Sem cor: adversário à frente (saldo negativo).", "No colour: opponent ahead (negative potential).")}</span>
      </div>
    </section>
  );
}

function TabelaTerr({ titulo: tit, linhas, nomeAdv, arquivo, bairro = false }: { titulo: string; linhas: Linha[]; nomeAdv: string; arquivo: string; bairro?: boolean }) {
  const [faixa, setFaixa] = useState<"todas" | Faixa>("todas");
  const dados = useMemo(() => (faixa === "todas" ? linhas : linhas.filter((l) => l.faixa === faixa)), [linhas, faixa]);
  const columns = useMemo<ColumnDef<Linha, unknown>[]>(() => [
    ...(bairro ? [{ id: "bairro", accessorKey: "bairro", header: L("Bairro", "Neighbourhood"), cell: (x: { getValue: () => unknown }) => <span className="font-semibold">{String(x.getValue())}</span> } as ColumnDef<Linha, unknown>] : []),
    { id: "cidade", accessorKey: "cidade", header: L("Cidade", "City"), cell: (x) => <span className={bairro ? "" : "font-semibold"}>{String(x.getValue())}</span> },
    { id: "aptos", accessorKey: "aptos", header: L("Eleitores", "Voters"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "abst", accessorKey: "abst", header: L("Abstenções", "Abstentions"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "taxaAbst", accessorKey: "taxaAbst", header: L("Abstenção", "Abstention"), cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "sL", accessorKey: "sL", header: "Lula", cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "sA", accessorKey: "sA", header: nomeAdv, cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "saldo", accessorKey: "saldo", header: L("Saldo potencial", "Potential"), cell: (x) => {
      const v = Math.round(Number(x.getValue()));
      return <span className={v > 0 ? "font-semibold text-accent" : "text-muted"}>{v > 0 ? "+" : ""}{fmt(v)}</span>;
    }, meta: { numeric: true } },
    { id: "faixa", accessorFn: (l) => NOME_FAIXA(l.faixa), header: L("Faixa", "Band") },
  ], [bairro, nomeAdv]);
  const exportCols: ExportCol<Linha>[] = [
    ...(bairro ? [{ header: L("Bairro", "Neighbourhood"), value: (l: Linha) => l.bairro ?? "" }] : []),
    { header: L("Cidade", "City"), value: (l) => l.cidade }, { header: L("Locais de votação", "Polling places"), value: (l) => l.locais, type: "number" },
    { header: L("Eleitores", "Voters"), value: (l) => l.aptos, type: "number" }, { header: L("Abstenções", "Abstentions"), value: (l) => l.abst, type: "number" },
    { header: L("Taxa de abstenção", "Abstention rate"), value: (l) => l.taxaAbst, type: "percent" },
    { header: L("Lula (% válidos)", "Lula (% valid)"), value: (l) => l.sL, type: "percent" }, { header: `${nomeAdv} (% válidos)`, value: (l) => l.sA, type: "percent" },
    { header: L("Saldo potencial (10%)", "Potential (10%)"), value: (l) => Math.round(l.saldo), type: "number" }, { header: L("Faixa", "Band"), value: (l) => NOME_FAIXA(l.faixa) },
  ];
  return (
    <section className="flex flex-col gap-2">
      <Segmented label={L("Faixa", "Band")} value={faixa} onChange={(v) => setFaixa(v as typeof faixa)}
        options={[{ id: "todas", label: L("Todas", "All") }, ...(["mobilizar", "disputar", "conter"] as Faixa[]).map((f) => ({ id: f, label: NOME_FAIXA(f) }))]} />
      <DataTable titulo={tit} data={dados} columns={columns} exportCols={exportCols} nomeArquivo={arquivo}
        busca={(l) => `${l.bairro ?? ""} ${l.cidade}`} initialSort={[{ id: "saldo", desc: true }]} pageSize={15}
        atalhos={[
          { label: L("Maior saldo", "Largest potential"), sort: [{ id: "saldo", desc: true }] },
          { label: L("Mais abstenções", "Most abstentions"), sort: [{ id: "abst", desc: true }] },
          { label: L("Maior taxa de abstenção", "Highest abstention rate"), sort: [{ id: "taxaAbst", desc: true }] },
          { label: L("Lula mais forte", "Lula strongest"), sort: [{ id: "sL", desc: true }] },
        ]} />
    </section>
  );
}

// ---- onde nossas candidaturas podem atuar ----

function Nossas({ base, uf, bairros }: { base: Base; uf: string; bairros: Linha[] }) {
  const cands = nossasDaUf(base, uf);
  if (!cands.length) return null;
  return (
    <section aria-label={L("Onde nossas candidaturas podem atuar", "Where our candidacies can act")} className="flex flex-col gap-3">
      <h2 className="display text-2xl">{L("Onde nossas candidaturas podem atuar", "Where our candidacies can act")}</h2>
      <p className="text-sm text-muted">
        {L("Cruzamento entre a base eleitoral de cada candidatura (bairros onde ela teve votação acima da sua média no estado) e o saldo potencial para Lula. São os territórios onde a candidatura tem rede e reconhecimento para puxar comparecimento no 2º turno.",
          "Cross-reference between each candidacy's electoral base (neighbourhoods where it polled above its state average) and Lula's potential. These are the territories where the candidacy has network and recognition to drive runoff turnout.")}
      </p>
      {cands.map((c) => <Nossa key={c.id} base={base} c={c} bairros={bairros} />)}
    </section>
  );
}

function Nossa({ base, c, bairros }: { base: Base; c: Candidatura; bairros: Linha[] }) {
  const { linhas: todas, loading } = useBaseCandidatura(base, c, bairros);
  const linhas = useMemo(() => (todas ?? []).filter((b) => b.saldo > 0), [todas]);
  const columns = useMemo<ColumnDef<LinhaNossa, unknown>[]>(() => [
    { id: "bairro", accessorKey: "bairro", header: L("Bairro", "Neighbourhood"), cell: (x) => <span className="font-semibold">{String(x.getValue())}</span> },
    { id: "cidade", accessorKey: "cidade", header: L("Cidade", "City") },
    { id: "votosC", accessorKey: "votosC", header: L("Votos da candidatura", "Candidacy votes"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "indice", accessorKey: "indice", header: L("Força relativa", "Relative strength"), cell: (x) => `${dec(Number(x.getValue()), 1)}×`, meta: { numeric: true } },
    { id: "abst", accessorKey: "abst", header: L("Abstenções", "Abstentions"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "sL", accessorKey: "sL", header: "Lula", cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "saldo", accessorKey: "saldo", header: L("Saldo potencial", "Potential"), cell: (x) => <span className="font-semibold text-accent">+{fmt(Math.round(Number(x.getValue())))}</span>, meta: { numeric: true } },
    { id: "score", accessorKey: "score", header: L("Prioridade", "Priority"), cell: (x) => fmt(Math.round(Number(x.getValue()))), meta: { numeric: true } },
  ], []);
  const exportCols: ExportCol<LinhaNossa>[] = [
    { header: L("Bairro", "Neighbourhood"), value: (l) => l.bairro ?? "" }, { header: L("Cidade", "City"), value: (l) => l.cidade },
    { header: L("Votos da candidatura", "Candidacy votes"), value: (l) => l.votosC, type: "number" }, { header: L("Força relativa", "Relative strength"), value: (l) => l.indice, type: "number" },
    { header: L("Abstenções", "Abstentions"), value: (l) => l.abst, type: "number" }, { header: L("Lula (% válidos)", "Lula (% valid)"), value: (l) => l.sL, type: "percent" },
    { header: L("Saldo potencial (10%)", "Potential (10%)"), value: (l) => Math.round(l.saldo), type: "number" }, { header: L("Prioridade", "Priority"), value: (l) => Math.round(l.score), type: "number" },
  ];
  const top = [...linhas].sort((a, b) => b.score - a.score).slice(0, 5);
  const somaSaldo = linhas.reduce((a, l) => a + l.saldo, 0);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
      <h3 className="text-lg font-semibold"><Link className="hover:text-accent" to={`/c/${c.id}`}>{titulo(c.nome)}</Link> <span className="text-sm font-normal text-muted">{c.partido} · {CARGOS[c.cargo]} · {fmt(c.votos)} {L("votos", "votes")}</span></h3>
      {loading ? <Loading /> : !linhas.length ? <p className="text-sm text-muted">{L("Sem bairros que combinem base forte e saldo positivo.", "No neighbourhoods combining a strong base and positive potential.")}</p> : (
        <>
          <p className="text-sm">
            {L(<>{fmt(linhas.length)} bairros combinam base forte da candidatura e saldo positivo para Lula, somando <b>+{fmt(Math.round(somaSaldo))}</b> votos líquidos a cada 10% de mobilização. Começar por: {top.map((b) => `${b.bairro} (${b.cidade})`).join(", ")}.</>,
              <>{fmt(linhas.length)} neighbourhoods combine a strong base for the candidacy and positive potential for Lula, adding up to <b>+{fmt(Math.round(somaSaldo))}</b> net votes per 10% turnout gain. Start with: {top.map((b) => `${b.bairro} (${b.cidade})`).join(", ")}.</>)}
          </p>
          <DataTable titulo={L(`${titulo(c.nome)}: bairros de atuação prioritária no 2º turno`, `${titulo(c.nome)}: priority neighbourhoods for the runoff`)} data={linhas} columns={columns} exportCols={exportCols}
            nomeArquivo={`esperanca_${c.numero}`} busca={(l) => `${l.bairro} ${l.cidade}`} initialSort={[{ id: "score", desc: true }]} pageSize={10}
            atalhos={[
              { label: L("Prioridade", "Priority"), sort: [{ id: "score", desc: true }] },
              { label: L("Base mais forte", "Strongest base"), sort: [{ id: "indice", desc: true }] },
              { label: L("Maior saldo", "Largest potential"), sort: [{ id: "saldo", desc: true }] },
            ]} />
          <p className="text-xs text-muted">{L("Força relativa = % dos válidos da candidatura no bairro ÷ % no estado (só bairros com 1,2× ou mais e 100+ votos). Prioridade = saldo potencial × força relativa (limitada a 3×).",
            "Relative strength = candidacy's % of valid votes in the neighbourhood ÷ its % statewide (only 1.2× or more and 100+ votes). Priority = potential × relative strength (capped at 3×).")}</p>
        </>
      )}
    </div>
  );
}
