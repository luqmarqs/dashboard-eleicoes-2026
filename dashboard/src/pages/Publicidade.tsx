import { candidaturaProvavel } from "../lib/paginas";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DataTable } from "../components/DataTable";
import { useMetaAnuncios, useMetaResumo } from "../lib/metaHooks";
import { TemasCriativos } from "../components/TemasCriativos";
import { AnunciosVotos } from "../components/AnunciosVotos";
import { EIXOS, normalizarTexto, rotuloDe, temasDoTexto } from "../lib/temas";
import { L, getLang } from "../lib/i18n";
import { LazyMap } from "../components/LazyMap";
import { ErrorBox, Loading, Segmented, SituacaoBadge, Stat, nomeCand } from "../components/ui";
import { BIVAR, classe, cssRgb, prefersDark, quantis, ramp, type RGB } from "../lib/colors";
import { agregar, porLocal, useBase, useTotais, useVotos, type Base, type LinhaAgregada } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { fmt, normalizar, pct, titulo } from "../lib/format";
import {
  LOC, abrangencia, circulou, fmtData, fmtDataHora, fmtFaixa, fmtNum, mediana, porMunicipio,
  rotuloAbrangencia, simbolo, somaFaixas, type Abrangencia, type Faixa, type PorMunicipio, custoPorMil, fmtCusto } from "../lib/meta";
import { source, type MetaAnuncio, type MetaMencao, type MetaResumo } from "../lib/source";
import { CARGOS, type Candidatura } from "../lib/types";
import { deUf, useUf } from "../lib/uf";

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];


function FaixaTxt({ f, prefixo = "" }: { f: Map<string, Faixa>; prefixo?: string }) {
  if (!f.size) return <>{L("não informado", "not reported")}</>;
  return <>{[...f.entries()].map(([moeda, x], i) => (
    <span key={moeda}>{i > 0 && " + "}{fmtFaixa(x.min, x.max, prefixo || simbolo(moeda))}</span>
  ))}</>;
}

export function Publicidade() {
  const base = useBase();
  const { info } = useUf();
  const resumo = useMetaResumo();
  const [sp, setSp] = useSearchParams();

  if (base.error) return <ErrorBox error={base.error} />;
  if (resumo.error) return <ErrorBox error={resumo.error} />;
  if (!base.data || !resumo.data) return <Loading />;
  const b = base.data;
  const r = resumo.data;
  const comAnuncios = r.candidaturas.filter((c) => c.anuncios > 0 && b.candById.has(c.candidatura_id));
  const padrao = comAnuncios.find((c) => b.candidaturasDestaque.includes(c.candidatura_id)) ?? comAnuncios[0];
  const candId = Number(sp.get("c")) || padrao?.candidatura_id;
  const cand = candId ? b.candById.get(candId) : undefined;
  const item = r.candidaturas.find((c) => c.candidatura_id === candId);
  const escolher = (id: number) => { const n = new URLSearchParams(sp); n.set("c", String(id)); n.delete("mun"); setSp(n, { replace: true }); };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="eyebrow">{L("Biblioteca de Anúncios da Meta · anúncios políticos · candidaturas eleitas", "Meta Ad Library · political ads · elected candidates")} {deUf(info)}</div>
        <h1 className="display text-3xl md:text-4xl">{L("Tráfego pago", "Paid ads")}</h1>
        <Cobertura r={r} />
        <details className="max-w-4xl text-sm text-muted">
          <summary className="cursor-pointer text-ink">{L("O que estes dados são — e o que não são", "What this data is — and what it is not")}</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            {getLang() === "en" ? <>
            <li><b>Targeting</b>: the locations the advertiser chose (included or excluded). Choosing a city does not prove
              the ad was seen there.</li>
            <li><b>Delivery</b>: the share of each ad's reach by state, reported by Meta. The API has no delivery by city
              or neighborhood.</li>
            <li><b>Votes</b>: TSE results. The cross-analysis is descriptive and aggregated: it shows where things coincide, not that the
              ad caused votes.</li>
            <li><b>Spend and impressions</b> are cumulative ranges per ad (from when it started until the last collection). The
              date filter picks ads that ran during the period; it does not trim spend to the period.</li>
            <li><b>Reach</b> is estimated per ad and is not summed (the same person may have seen several ads).</li>
            </> : <>
            <li><b>Segmentação</b>: as localidades que o anunciante escolheu (incluídas ou excluídas). Escolher uma cidade não prova
              que o anúncio foi visto lá.</li>
            <li><b>Entrega</b>: a parcela do alcance de cada anúncio por estado, informada pela Meta. Não existe entrega por cidade
              ou bairro na API.</li>
            <li><b>Votação</b>: resultado do TSE. O cruzamento é descritivo e agregado: mostra onde há coincidência, não que o
              anúncio causou votos.</li>
            <li><b>Gasto e impressões</b> são faixas acumuladas por anúncio (de quando começou até a última coleta). O filtro de
              período escolhe anúncios que circularam no período; não recorta o gasto para o período.</li>
            <li><b>Alcance</b> é estimado por anúncio e não se soma (a mesma pessoa pode ter visto vários anúncios).</li>
            </>}
          </ul>
        </details>
      </header>

      <TabelaCandidaturas base={b} r={r} selecionada={candId} onEscolher={escolher} />

      {cand && item ? (
        <AnunciosCandidatura key={cand.id} base={b} cand={cand} item={item} />
      ) : (
        <p className="text-muted">{L("Nenhuma candidatura com anúncios coletados", "No candidates with collected ads")} {deUf(info)}.</p>
      )}
    </div>
  );
}

function Cobertura({ r }: { r: MetaResumo }) {
  const e = r.execucao;
  if (!e) return <p className="rounded-md border border-line bg-panel px-3 py-2 text-sm">{L("Ainda não há coleta carregada.", "No collection loaded yet.")}</p>;
  const parcial = e.status !== "completa";
  return (
    <p className={`max-w-4xl rounded-md border px-3 py-2 text-sm ${parcial ? "border-danger text-danger" : "border-line bg-panel text-muted"}`}>
      {getLang() === "en" ? <>
      Last collection: <b className="text-ink">{fmtDataHora(e.terminada_em ?? e.iniciada_em)}</b>
      {" · "}{parcial ? <b>collection {e.status}: {e.paginas_concluidas ?? 0} of {e.paginas_alvo} Pages completed</b>
        : <>{e.paginas_concluidas} of {e.paginas_alvo} Pages, pagination complete</>}
      {" · "}ads running since {fmtData(e.periodo_min)} · Graph API {e.versao_api}
      </> : <>
      Última coleta: <b className="text-ink">{fmtDataHora(e.terminada_em ?? e.iniciada_em)}</b>
      {" · "}{parcial ? <b>coleta {e.status}: {e.paginas_concluidas ?? 0} de {e.paginas_alvo} páginas concluídas</b>
        : <>{e.paginas_concluidas} de {e.paginas_alvo} páginas, paginação concluída</>}
      {" · "}anúncios veiculados desde {fmtData(e.periodo_min)} · Graph API {e.versao_api}
      </>}
    </p>
  );
}

interface LinhaCand {
  id: number; c: Candidatura; anuncios: number; gmin: number | null; gmax: number | null; aberto: boolean;
  paginas: number; naoConfirmada: boolean; cmin: number | null; cmax: number | null;
}

function TabelaCandidaturas({ base, r, selecionada, onEscolher }: {
  base: Base; r: MetaResumo; selecionada?: number; onEscolher: (id: number) => void;
}) {
  const linhas = useMemo<LinhaCand[]>(() => r.candidaturas.flatMap((x) => {
    const c = base.candById.get(x.candidatura_id);
    return c ? [{ id: c.id, c, anuncios: x.anuncios, gmin: x.gasto_min, gmax: x.gasto_max, aberto: !!x.gasto_aberto,
      paginas: x.paginas.length, naoConfirmada: x.paginas.some((p) => p.status_revisao !== "confirmado"),
      cmin: x.custo_mil_min ?? null, cmax: x.custo_mil_max ?? null }] : [];
  }), [r, base]);
  const eleitas = base.candidaturas.filter((c) => c.tipo === "nominal" && c.situacao?.startsWith("Eleito"));
  const semPagina = eleitas.filter((c) => !r.candidaturas.some((x) => x.candidatura_id === c.id));
  const columns = useMemo<ColumnDef<LinhaCand, unknown>[]>(() => [
    { id: "nome", accessorFn: (l) => l.c.nome, header: L("Candidatura", "Candidate"), cell: (x) => {
      const l = x.row.original;
      return (
        <button type="button" onClick={() => onEscolher(l.id)} className={`text-left ${l.id === selecionada ? "font-bold text-accent" : "font-semibold hover:text-accent"}`}>
          {nomeCand(l.c)}<SituacaoBadge c={l.c} compacto />
          <div className="text-xs font-normal text-muted">{CARGOS[l.c.cargo]} · {l.c.partido}{l.naoConfirmada ? L(" · vínculo a revisar", " · link pending review") : ""}</div>
        </button>
      );
    } },
    { id: "anuncios", accessorKey: "anuncios", header: L("Anúncios", "Ads"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "gasto", accessorFn: (l) => l.gmax ?? l.gmin ?? 0, header: L("Gasto declarado (faixa)", "Declared spend (range)"),
      cell: (x) => { const l = x.row.original; return fmtFaixa(l.gmin, l.aberto ? null : l.gmax, "R$ "); }, meta: { numeric: true } },
    { id: "custo", accessorFn: (l) => l.cmin ?? undefined, header: L("Custo por mil alcançados", "Cost per 1,000 reached"),
      cell: (x) => { const l = x.row.original; return l.cmin == null ? "–" : fmtCusto({ min: l.cmin, max: l.cmax }); }, sortUndefined: "last", meta: { numeric: true } },
    { id: "paginas", accessorKey: "paginas", header: L("Páginas", "Pages"), meta: { numeric: true } },
  ], [onEscolher, selecionada]);
  const exportCols: ExportCol<LinhaCand>[] = [
    { header: L("Número", "Number"), value: (l) => l.c.numero, type: "number" }, { header: L("Candidatura", "Candidate"), value: (l) => l.c.nome },
    { header: L("Cargo", "Office"), value: (l) => CARGOS[l.c.cargo] }, { header: L("Partido", "Party"), value: (l) => l.c.partido ?? "" },
    { header: L("Anúncios", "Ads"), value: (l) => l.anuncios, type: "number" },
    { header: L("Gasto mínimo (soma das faixas, R$)", "Minimum spend (sum of ranges, R$)"), value: (l) => l.gmin, type: "number" },
    { header: L("Gasto máximo (soma das faixas, R$; vazio = sem teto)", "Maximum spend (sum of ranges, R$; empty = no upper bound)"), value: (l) => (l.aberto ? null : l.gmax), type: "number" },
    { header: L("Vínculo a revisar", "Link pending review"), value: (l) => (l.naoConfirmada ? L("sim", "yes") : L("não", "no")) },
  ];
  return (
    <section aria-label={L("Candidaturas", "Candidates")} className="flex flex-col gap-2">
      <h2 className="display text-2xl">{L("Candidaturas", "Candidates")}</h2>
      <DataTable titulo={L("Anúncios pagos (Meta) e gasto declarado, por candidatura", "Paid ads (Meta) and declared spend, by candidacy")} data={linhas} columns={columns} exportCols={exportCols} nomeArquivo="trafego_pago_candidaturas"
        busca={(l) => `${l.c.numero} ${l.c.nome} ${l.c.partido ?? ""}`} initialSort={[{ id: "gasto", desc: true }]} pageSize={10} />
      <p className="text-xs text-muted">
        {getLang() === "en" ? <>
        A Page is linked to a candidate when the declared funder in the ads is that candidate's campaign CNPJ ("ELEIÇÃO 2026 + full
        name at TSE"). {semPagina.length > 0 && <>{fmt(semPagina.length)} of {fmt(eleitas.length)} elected candidates with no
        identified Page (they may not have advertised, or may advertise under another funder).</>}
        </> : <>
        Página ligada à candidatura quando o financiador declarado nos anúncios é o CNPJ de campanha dela ("ELEIÇÃO 2026 + nome
        completo no TSE"). {semPagina.length > 0 && <>{fmt(semPagina.length)} de {fmt(eleitas.length)} candidaturas eleitas sem
        página identificada (podem não ter anunciado, ou anunciar com outro financiador).</>}
        </>}
      </p>
      {semPagina.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">{L("Ver eleitas sem página identificada", "Show elected candidates with no identified Page")}</summary>
          <p className="mt-1">{semPagina.map((c) => `${c.nome} (${c.numero})`).join(" · ")}</p>
        </details>
      )}
    </section>
  );
}

type ModoMapa = "segmentacao" | "votacao" | "cruzamento";
type Fonte = "proprios" | "recebe" | "faz";

function AnunciosCandidatura({ base, cand, item }: { base: Base; cand: Candidatura; item: MetaResumo["candidaturas"][number] }) {
  const { info } = useUf();
  const ads = useMetaAnuncios(cand.id, item.ultima_coleta);
  const { uf } = useUf();
  const dob = useQuery({ queryKey: ["meta-dobradas", uf, cand.id], queryFn: () => source.metaDobradas(cand.id), staleTime: 5 * 60_000 });
  const [fonteSel, setFonte] = useState<Fonte | null>(null);
  const [parceira, setParceira] = useState<string>("todas"); // id da outra candidatura, "sem" (pagador não identificado) ou "todas"
  const votos = useVotos([cand.id], null);
  const totais = useTotais(cand.cargo, null);
  const [sp, setSp] = useSearchParams();
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [plataforma, setPlataforma] = useState("todas");
  const [modo, setModo] = useState<ModoMapa>("segmentacao");
  const [mostrar, setMostrar] = useState(20);
  const [tema, setTema] = useState<string | null>(null);
  const municipio = sp.get("mun");
  const setMunicipio = (cd: string | null) => {
    const n = new URLSearchParams(sp);
    if (cd) n.set("mun", cd); else n.delete("mun");
    setSp(n, { replace: true });
  };
  const dark = prefersDark();

  const proprios = ads.data ?? [];
  const mencoes = dob.data ?? [];
  // sem anúncios próprios (ex.: Manuela), abre direto nas dobradas recebidas
  const fonte: Fonte = fonteSel ?? (proprios.length || !mencoes.some((m) => m.papel === "recebe") ? "proprios" : "recebe");
  const mencoesFonte = useMemo(() => mencoes.filter((m) => m.papel === fonte), [mencoes, fonte]);
  const mencaoPorAd = useMemo(() => {
    const m = new Map<string, MetaMencao[]>();
    for (const x of mencoesFonte) m.set(x.ad.id, [...(m.get(x.ad.id) ?? []), x]);
    return m;
  }, [mencoesFonte]);
  const todas = useMemo(() => {
    if (fonte === "proprios") return proprios;
    const vistos = new Set<string>();
    const out: MetaAnuncio[] = [];
    for (const m of mencoesFonte) {
      const k = m.outra == null ? "sem" : String(m.outra);
      if ((parceira === "todas" || parceira === k) && !vistos.has(m.ad.id)) { vistos.add(m.ad.id); out.push(m.ad); }
    }
    return out;
  }, [fonte, proprios, mencoesFonte, parceira]);
  const plataformas = useMemo(() => [...new Set(todas.flatMap((a) => a.plataformas ?? []))].sort(), [todas]);
  const temasAd = useMemo(() => new Map(todas.map((a) => [a.id, temasDoTexto(normalizarTexto(a))])), [todas]);
  const filtradosBase = useMemo(() => todas.filter((a) => circulou(a, de || null, ate || null)
    && (plataforma === "todas" || (a.plataformas ?? []).includes(plataforma))), [todas, de, ate, plataforma]);
  const filtrados = useMemo(() => (tema ? filtradosBase.filter((a) => temasAd.get(a.id)?.has(tema)) : filtradosBase),
    [filtradosBase, tema, temasAd]);
  // o card de temas mostra o recorte sem o próprio filtro de tema (as parcelas não mudam ao clicar)
  const paraTemas = useMemo(() => (municipio
    ? filtradosBase.filter((a) => a.loc.some((l) => l[LOC.cd] === municipio && l[LOC.status] === "validada"))
    : filtradosBase), [filtradosBase, municipio]);
  const mun = useMemo(() => porMunicipio(filtrados), [filtrados]);
  const lista = useMemo(() => (municipio
    ? filtrados.filter((a) => a.loc.some((l) => l[LOC.cd] === municipio && l[LOC.status] === "validada"))
    : filtrados), [filtrados, municipio]);

  const pl = useMemo(() => (votos.data && totais.data ? porLocal(base, votos.data[cand.id], totais.data) : undefined),
    [base, votos.data, totais.data, cand.id]);
  const votosMun = useMemo(() => new Map((pl ? agregar(base, pl, "municipio") : []).map((l) => [l.key, l])), [base, pl]);

  // ---- cores do mapa ----
  const contagem = useCallback((cd: string) => { const x = mun.get(cd); return x ? x.inclui.size + x.bairro.size : 0; }, [mun]);
  const breaksSeg = useMemo(() => quantis([...mun.keys()].map(contagem)), [mun, contagem]);
  const breaksVoto = useMemo(() => quantis([...votosMun.values()].map((l) => l.pct)), [votosMun]);
  const tercis = useMemo(() => {
    const s = [...votosMun.values()].map((l) => l.pct).filter((v) => v > 0).sort((a, b) => a - b);
    return s.length ? [s[Math.floor(s.length / 3)], s[Math.floor((2 * s.length) / 3)]] : [0, 0];
  }, [votosMun]);
  const EXCLUIDA = hex(dark ? "#c47c22" : "#c86a00");
  const VAZIO = hex(dark ? "#2a2430" : "#eeebf0");
  const corPorMunicipio = useCallback((cd: string): RGB | null => {
    const x = mun.get(cd);
    const n = contagem(cd);
    const r = ramp();
    if (modo === "segmentacao") {
      if (n > 0) return r[Math.min(classe(n, breaksSeg) + 1, r.length - 1)];
      return x && x.exclui.size ? EXCLUIDA : VAZIO;
    }
    const v = votosMun.get(cd);
    if (modo === "votacao") return v && v.votos > 0 ? r[Math.min(classe(v.pct, breaksVoto), r.length - 1)] : VAZIO;
    const t = v ? (v.pct > tercis[1] ? 2 : v.pct > tercis[0] ? 1 : 0) : 0;
    return BIVAR[n > 0 ? 2 : 0][t];
  }, [mun, contagem, modo, breaksSeg, votosMun, breaksVoto, tercis, EXCLUIDA, VAZIO]);
  const infoExtra = useCallback(({ municipio: cd }: { municipio?: string }) => {
    if (!cd) return null;
    const x = mun.get(cd);
    const partes = [L(`${x?.inclui.size ?? 0} anúncio(s) incluem a cidade`, `${x?.inclui.size ?? 0} ad(s) include the city`)];
    if (x?.bairro.size) partes.push(L(`${x.bairro.size} incluem bairro(s) dela`, `${x.bairro.size} include its neighborhood(s)`));
    if (x?.exclui.size) partes.push(L(`${x.exclui.size} a excluem`, `${x.exclui.size} exclude it`));
    return partes.join("<br>");
  }, [mun]);

  if (ads.error) return <ErrorBox error={ads.error} />;
  if (dob.error) return <ErrorBox error={dob.error} />;
  if (!ads.data || !dob.data) return <Loading texto={L("Carregando anúncios…", "Loading ads…")} />;
  const nRecebe = new Set(mencoes.filter((m) => m.papel === "recebe").map((m) => m.ad.id)).size;
  const nFaz = new Set(mencoes.filter((m) => m.papel === "faz").map((m) => m.ad.id)).size;
  const rotuloGasto = fonte === "proprios" ? L("gasto declarado desses anúncios (soma das faixas, acumulado)", "declared spend on these ads (sum of ranges, cumulative)")
    : fonte === "recebe" ? L("gasto das campanhas que pagaram esses anúncios (não é gasto desta candidatura)", "spend by the campaigns that paid for these ads (not this candidate's spend)")
    : L("gasto desta candidatura nos anúncios que citam outras", "this candidate's spend on ads that mention others");

  const gasto = somaFaixas(lista, "gasto");
  const impr = somaFaixas(lista, "impressoes");
  const alcanceMed = mediana(lista.map((a) => a.alcance).filter((x): x is number => x != null));
  const porAbr = new Map<Abrangencia, number>();
  for (const a of lista) porAbr.set(abrangencia(a), (porAbr.get(abrangencia(a)) ?? 0) + 1);
  const inicio = lista.reduce<string | null>((m, a) => (a.inicio && (!m || a.inicio < m) ? a.inicio : m), null);
  const fim = lista.reduce<string | null>((m, a) => { const f = a.fim ?? a.ultima_coleta.slice(0, 10); return !m || f > m ? f : m; }, null);
  const munNome = municipio ? titulo(base.munByCd.get(municipio)?.nome ?? municipio) : null;

  return (
    <section aria-label={L(`Anúncios de ${cand.nome}`, `Ads by ${cand.nome}`)} className="flex flex-col gap-5 border-t border-line pt-5">
      <header className="flex flex-col gap-1">
        <div className="eyebrow">{CARGOS[cand.cargo]} · {cand.partido}</div>
        <h2 className="display text-2xl md:text-3xl">
          <Link to={`/c/${cand.id}`} className="hover:text-accent">{nomeCand(cand)}</Link><SituacaoBadge c={cand} />
        </h2>
        <ul className="flex flex-wrap gap-2 text-xs">
          {item.paginas.map((p) => (
            <li key={p.page_id} title={p.evidencia ?? ""}
              className={`rounded border px-2 py-0.5 ${p.status_revisao === "confirmado" ? "border-line" : "border-danger text-danger"}`}>
              {L("Página", "Page")} “{p.page_name}” · {p.status_revisao === "confirmado" ? L("vínculo confirmado (financiador)", "link confirmed (funder)") : L("vínculo NÃO confirmado — a revisar", "link NOT confirmed — pending review")}
            </li>
          ))}
        </ul>
      </header>

      <Segmented label={L("Fonte dos anúncios", "Ad source")} value={fonte} onChange={(f) => { setFonte(f); setParceira("todas"); setMunicipio(null); }} options={[
        { id: "proprios", label: L(`Anúncios próprios (${fmt(proprios.length)})`, `Own ads (${fmt(proprios.length)})`) },
        { id: "recebe", label: L(`Dobradas: outras campanhas citam (${fmt(nRecebe)})`, `Joint tickets: other campaigns mention (${fmt(nRecebe)})`) },
        { id: "faz", label: L(`Dobradas: cita outras (${fmt(nFaz)})`, `Joint tickets: mentions others (${fmt(nFaz)})`) },
      ]} />
      {fonte !== "proprios" && (
        <Parceiras base={base} cand={cand} mencoes={mencoesFonte} fonte={fonte} parceira={parceira} onParceira={setParceira} />
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-panel p-3 text-sm">
        <label className="flex flex-col gap-1 text-muted">{L("Circulou a partir de", "Ran from")}
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1 text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-muted">{L("até", "to")}
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1 text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-muted">{L("Plataforma", "Platform")}
          <Segmented label={L("Plataforma", "Platform")} value={plataforma} onChange={setPlataforma}
            options={[{ id: "todas", label: L("Todas", "All") }, ...plataformas.map((p) => ({ id: p, label: titulo(p.replace(/_/g, " ")) }))]} />
        </label>
        <label htmlFor="pub-mun" className="flex flex-col gap-1 text-muted">{L("Cidade segmentada", "Targeted city")}
          <select id="pub-mun" value={municipio ?? ""} onChange={(e) => setMunicipio(e.target.value || null)}
            className="rounded-md border border-line bg-panel px-2 py-1 text-ink">
            <option value="">{L("Todas", "All")}</option>
            {[...mun.values()].filter((x) => x.inclui.size + x.bairro.size > 0 && base.munByCd.has(x.cd))
              .sort((a, b) => (b.inclui.size + b.bairro.size) - (a.inclui.size + a.bairro.size))
              .map((x) => <option key={x.cd} value={x.cd}>{titulo(base.munByCd.get(x.cd)!.nome)} ({x.inclui.size + x.bairro.size})</option>)}
          </select>
        </label>
        {(de || ate || plataforma !== "todas" || municipio) && (
          <button type="button" onClick={() => { setDe(""); setAte(""); setPlataforma("todas"); setMunicipio(null); }}
            className="rounded-md border border-line px-3 py-1 hover:bg-accent-soft">{L("Limpar", "Clear")}</button>
        )}
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Stat valor={fmt(lista.length)} rotulo={getLang() === "en" ? <>ads{municipio ? <> that include {munNome}</> : null}{lista.length !== todas.length ? ` (of ${fmt(todas.length)})` : ""}</> : <>anúncios{municipio ? <> que incluem {munNome}</> : null}{lista.length !== todas.length ? ` (de ${fmt(todas.length)})` : ""}</>} />
        <Stat valor={<FaixaTxt f={gasto} />} rotulo={rotuloGasto} />
        <Stat valor={<FaixaTxt f={impr} prefixo=" " />} rotulo={L("impressões (soma das faixas)", "impressions (sum of ranges)")} />
        <Stat valor={fmtCusto(custoPorMil(lista))} rotulo={L("custo por mil alcançados (gasto ÷ alcance somado dos anúncios)", "cost per 1,000 reached (spend ÷ summed ad reach)")} />
        <Stat valor={alcanceMed != null ? fmtNum(alcanceMed) : "–"} rotulo={L("alcance estimado por anúncio (mediana; não se soma)", "estimated reach per ad (median; not summed)")} />
        <Stat valor={`${fmtData(inicio)} – ${fmtData(fim)}`} rotulo={L("veiculação", "run dates")} />
      </div>
      {municipio && (
        <p className="text-xs text-muted">
          {getLang() === "en" ? <>
          The spend above is the total for these ads everywhere they ran, not the spend in {munNome}: Meta does not
          report spend by city.
          </> : <>
          O gasto acima é o total desses anúncios em todos os lugares em que circularam, não o gasto em {munNome}: a Meta não
          informa gasto por cidade.
          </>}
        </p>
      )}

      <TemasCriativos ads={paraTemas} tema={tema} onTema={setTema} />

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-2">
          <Segmented label={L("O que o mapa mostra", "What the map shows")} value={modo} onChange={setModo} options={[
            { id: "segmentacao", label: L("Segmentação", "Targeting") }, { id: "votacao", label: L("Votação", "Votes") }, { id: "cruzamento", label: L("Segmentação × votação", "Targeting × votes") },
          ]} />
          {pl ? (
            <LazyMap base={base} dados={pl} municipio={null} modo="municipios" metrica="pct" corPorMunicipio={corPorMunicipio}
              infoExtra={infoExtra} rotuloSerie={L(`votos de ${titulo(cand.nome)}`, `${titulo(cand.nome)} votes`)} onMunicipio={(cd) => setMunicipio(cd)} altura="min(62vh, 640px)" />
          ) : <Loading texto={L("Carregando votação…", "Loading votes…")} />}
          <LegendaPub modo={modo} breaks={breaksSeg} breaksVoto={breaksVoto} excluida={EXCLUIDA} vazio={VAZIO} />
          <p className="text-xs text-muted">
            {getLang() === "en" ? <>
            Targeting by city (or by neighborhood with an identified city) {deUf(info)}; ads aimed at the whole state do not
            color cities. Click a city to see the ads that include it.
            </> : <>
            Segmentação por cidade (ou por bairro com cidade identificada) {deUf(info)}; anúncios que miram o estado inteiro não
            pintam cidades. Clique numa cidade para ver os anúncios que a incluem.
            </>}
          </p>
        </div>
        <aside className="flex flex-col gap-4">
          <div>
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide">{L("Recorte geográfico escolhido", "Chosen geographic targeting")}</h3>
            <ul className="text-sm">
              {(["municipio", "bairro", "cep", "uf", "pais", "desconhecida", "sem_segmentacao"] as Abrangencia[])
                .filter((k) => porAbr.get(k)).map((k) => (
                  <li key={k} className="flex justify-between border-b border-line py-1">
                    <span>{rotuloAbrangencia(k)}</span><span className="num">{fmt(porAbr.get(k)!)} {L("anúncios", "ads")}</span>
                  </li>
                ))}
            </ul>
            <p className="mt-1 text-xs text-muted">{L("Recorte mais fino entre as localidades incluídas de cada anúncio.", "Finest level among each ad's included locations.")}</p>
          </div>
          <Entrega ads={lista} />
        </aside>
      </div>

      <AnunciosVotos base={base} ads={filtrados} votosMun={votosMun} nome={cand.nome} onMunicipio={setMunicipio} />

      <Efetividade base={base} mun={mun} votosMun={votosMun} ads={filtrados} cand={cand} onMunicipio={setMunicipio} />

      <section aria-label={L("Lista de anúncios", "Ad list")} className="flex flex-col gap-3">
        <h3 className="display text-xl">{L("Anúncios", "Ads")}{municipio ? L(` que incluem ${munNome}`, ` that include ${munNome}`) : ""}{tema ? ` · ${L("tema", "theme")}: ${(() => { const t = EIXOS.flatMap((e) => e.temas).find((t) => t.id === tema); return t ? rotuloDe(t) : ""; })()}` : ""}</h3>
        {lista.slice(0, mostrar).map((a) => <CardAnuncio key={a.id} a={a} mencoes={mencaoPorAd.get(a.id)} base={base} />)}
        {lista.length > mostrar && (
          <button type="button" onClick={() => setMostrar((m) => m + 20)}
            className="self-start rounded-md border border-line px-3 py-1.5 text-sm hover:bg-accent-soft">
            {L(`Mostrar mais (${fmt(lista.length - mostrar)} restantes)`, `Show more (${fmt(lista.length - mostrar)} remaining)`)}
          </button>
        )}
      </section>
    </section>
  );
}

function LegendaPub({ modo, breaks, breaksVoto, excluida, vazio }: {
  modo: ModoMapa; breaks: number[]; breaksVoto: number[]; excluida: RGB; vazio: RGB;
}) {
  const r = ramp();
  const sw = (c: RGB, t: string) => (
    <span key={t} className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm border border-line" style={{ background: cssRgb(c) }} />{t}</span>
  );
  let itens: React.ReactNode[];
  if (modo === "segmentacao") {
    const lim = [1, ...breaks.map((b) => b + 1)];
    itens = [sw(vazio, L("nenhum anúncio inclui", "no ad includes")), sw(excluida, L("só excluída", "excluded only")),
      ...[...new Set(lim)].slice(0, 6).map((v, i, arr) => sw(r[Math.min(i + 1, r.length - 1)], i === arr.length - 1 ? L(`${v}+ anúncios`, `${v}+ ads`) : `${v}${arr[i + 1] - 1 > v ? `–${arr[i + 1] - 1}` : ""}`))];
  } else if (modo === "votacao") {
    itens = r.map((c, i) => sw(c, i === 0 ? `${L("até", "up to")} ${pct(breaksVoto[0] ?? 0, 1)}` : `${pct(breaksVoto[i - 1] ?? 0, 1)}+`));
  } else {
    itens = [sw(BIVAR[2][2], L("segmentada · votação alta", "targeted · high vote share")), sw(BIVAR[2][1], L("segmentada · média", "targeted · medium")), sw(BIVAR[2][0], L("segmentada · baixa", "targeted · low")),
      sw(BIVAR[0][2], L("não segmentada · votação alta", "not targeted · high vote share")), sw(BIVAR[0][1], L("não segmentada · média", "not targeted · medium")), sw(BIVAR[0][0], L("não segmentada · baixa", "not targeted · low"))];
  }
  return <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label={L("Legenda", "Legend")}>{itens}</div>;
}

function Entrega({ ads }: { ads: MetaAnuncio[] }) {
  const linhas = useMemo(() => {
    const m = new Map<string, number[]>();
    let sem = 0;
    for (const a of ads) {
      if (!a.entrega.length) { sem++; continue; }
      for (const [uf, p] of a.entrega) if (p != null) m.set(uf, [...(m.get(uf) ?? []), p]);
    }
    return { sem, ufs: [...m.entries()].map(([uf, ps]) => ({ uf, n: ps.length, med: mediana(ps)! })).sort((a, b) => b.n - a.n || b.med - a.med) };
  }, [ads]);
  return (
    <div>
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wide">{L("Entrega (onde a Meta diz que chegou)", "Delivery (where Meta says it reached)")}</h3>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="py-1">{L("Região", "Region")}</th><th className="text-right">{L("Anúncios", "Ads")}</th><th className="text-right">{L("Mediana do alcance", "Median reach share")}</th></tr></thead>
        <tbody>
          {linhas.ufs.slice(0, 8).map((l) => (
            <tr key={l.uf} className="border-t border-line"><td className="py-1">{l.uf}</td><td className="num text-right">{fmt(l.n)}</td><td className="num text-right">{l.med > 0 && l.med < 0.01 ? "<1%" : pct(l.med, 0)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-muted">
        {L("Parcela do alcance de cada anúncio por estado (só há este nível).", "Share of each ad's reach by state (the only level available).")} {linhas.sem > 0 && L(`${fmt(linhas.sem)} anúncios sem distribuição informada.`, `${fmt(linhas.sem)} ads with no distribution reported.`)}
      </p>
    </div>
  );
}

interface LinhaEf { cd: string; nome: string; inclui: number; bairro: number; exclui: number; inicio: string | null; fim: string | null;
  gmin: number; gmax: number | null; votos: number; validos: number; pct: number; custo: { min: number; max: number | null } | null }

function Efetividade({ base, mun, votosMun, ads, cand, onMunicipio }: {
  base: Base; mun: Map<string, PorMunicipio>; votosMun: Map<string, LinhaAgregada>; ads: MetaAnuncio[]; cand: Candidatura;
  onMunicipio: (cd: string) => void;
}) {
  const porId = useMemo(() => new Map(ads.map((a) => [a.id, a])), [ads]);
  const total = useMemo(() => [...votosMun.values()].reduce((s, l) => s + l.votos, 0), [votosMun]);
  const linhas = useMemo<LinhaEf[]>(() => base.municipios.map((m) => {
    const x = mun.get(m.cd);
    const ids = new Set([...(x?.inclui ?? []), ...(x?.bairro ?? [])]);
    const adsCidade = [...ids].map((i) => porId.get(i)!).filter(Boolean);
    const g = somaFaixas(adsCidade, "gasto").get("BRL");
    const custo = custoPorMil(adsCidade);
    const v = votosMun.get(m.cd);
    return { cd: m.cd, nome: m.nome, inclui: x?.inclui.size ?? 0, bairro: x?.bairro.size ?? 0, exclui: x?.exclui.size ?? 0,
      inicio: x?.inicio ?? null, fim: x?.fim ?? null, gmin: g?.min ?? 0, gmax: g ? g.max : 0,
      votos: v?.votos ?? 0, validos: v?.validos ?? 0, pct: v?.pct ?? 0, custo };
  }), [base, mun, porId, votosMun]);


  const columns = useMemo<ColumnDef<LinhaEf, unknown>[]>(() => [
    { id: "nome", accessorKey: "nome", header: L("Município", "City"), cell: (x) => (
      <button type="button" className="text-left font-semibold hover:text-accent" onClick={() => onMunicipio(x.row.original.cd)}>{titulo(x.row.original.nome)}</button>
    ) },
    { id: "inclui", accessorKey: "inclui", header: L("Anúncios que incluem", "Ads that include"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "bairro", accessorKey: "bairro", header: L("…via bairro", "…via neighborhood"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "exclui", accessorKey: "exclui", header: L("Que excluem", "That exclude"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "custo", accessorFn: (l) => l.custo?.min ?? undefined, header: L("Custo por mil alcançados", "Cost per 1,000 reached"), cell: (x) => fmtCusto(x.row.original.custo), sortUndefined: "last", meta: { numeric: true } },
    { id: "gasto", accessorFn: (l) => l.gmax ?? l.gmin, header: L("Gasto total desses anúncios*", "Total spend of these ads*"),
      cell: (x) => { const l = x.row.original; return l.inclui + l.bairro ? fmtFaixa(l.gmin, l.gmax, "R$ ") : "–"; }, meta: { numeric: true } },
    { id: "periodo", accessorFn: (l) => l.inicio ?? "", header: L("Veiculação", "Run dates"), cell: (x) => { const l = x.row.original; return l.inicio ? `${fmtData(l.inicio)} – ${fmtData(l.fim)}` : "–"; } },
    { id: "votos", accessorKey: "votos", header: L("Votos", "Votes"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "pct", accessorKey: "pct", header: L("% válidos", "% valid"), cell: (x) => pct(Number(x.getValue())), meta: { numeric: true } },
    { id: "share", accessorFn: (l) => (total ? l.votos / total : 0), header: L("% do total", "% of total"), cell: (x) => pct(Number(x.getValue())), meta: { numeric: true } },
  ], [onMunicipio, total]);
  const exportCols: ExportCol<LinhaEf>[] = [
    { header: L("Município", "City"), value: (l) => l.nome }, { header: L("Código TSE", "TSE code"), value: (l) => l.cd },
    { header: L("Anúncios que incluem a cidade", "Ads that include the city"), value: (l) => l.inclui, type: "number" },
    { header: L("Anúncios que incluem bairro da cidade", "Ads that include a neighborhood of the city"), value: (l) => l.bairro, type: "number" },
    { header: L("Anúncios que excluem a cidade", "Ads that exclude the city"), value: (l) => l.exclui, type: "number" },
    { header: L("Gasto total dos anúncios associados - mínimo (não é gasto na cidade)", "Total spend of associated ads - minimum (not spend in the city)"), value: (l) => (l.inclui + l.bairro ? l.gmin : null), type: "number" },
    { header: L("Gasto total dos anúncios associados - máximo (vazio = sem teto)", "Total spend of associated ads - maximum (empty = no upper bound)"), value: (l) => (l.inclui + l.bairro ? l.gmax : null), type: "number" },
    { header: L("Primeira veiculação", "First run date"), value: (l) => l.inicio ?? "" }, { header: L("Última veiculação", "Last run date"), value: (l) => l.fim ?? "" },
    { header: L("Votos", "Votes"), value: (l) => l.votos, type: "number" }, { header: L("% válidos", "% valid"), value: (l) => l.pct, type: "percent" },
    { header: L("% do total da candidatura", "% of the candidate's total"), value: (l) => (total ? l.votos / total : 0), type: "percent" },
  ];
  return (
    <section aria-label={L("Segmentação e votação", "Targeting and votes")} className="flex flex-col gap-3">
      <h3 className="display text-xl">{L("Por cidade", "By city")}</h3>
      <DataTable titulo={L(`Anúncios pagos (Meta) e votos de ${titulo(cand.nome)}, por cidade`, `Paid ads (Meta) and ${titulo(cand.nome)} votes, by city`)} data={linhas} columns={columns} exportCols={exportCols} nomeArquivo={`trafego_pago_${cand.numero}_municipios`}
        busca={(l) => normalizar(l.nome)} initialSort={[{ id: "inclui", desc: true }]} pageSize={15}
        atalhos={[
          { label: L("Mais anúncios", "Most ads"), sort: [{ id: "inclui", desc: true }] },
          { label: L("Mais votos", "Most votes"), sort: [{ id: "votos", desc: true }] },
          { label: L("Maior % válidos", "Highest % valid"), sort: [{ id: "pct", desc: true }] },
        ]} />
      <p className="text-xs text-muted">
        {getLang() === "en" ? <>
        * Total spend (cumulative range) of the ads that include the city, summing what they spent everywhere. It is not the
        spend in the city, and the same ad appears in every city it includes.
        </> : <>
        * Gasto total (faixa acumulada) dos anúncios que incluem a cidade, somando o que gastaram em todos os lugares. Não é o
        gasto na cidade, e o mesmo anúncio aparece em todas as cidades que ele inclui.
        </>}
      </p>
    </section>
  );
}

function CardAnuncio({ a, mencoes, base }: { a: MetaAnuncio; mencoes?: MetaMencao[]; base: Base }) {
  const [aberto, setAberto] = useState(false);
  const texto = (a.textos ?? []).join("\n\n");
  const curto = texto.length > 320 && !aberto ? `${texto.slice(0, 320)}…` : texto;
  const inc = a.loc.filter((l) => !l[LOC.excluida]);
  const exc = a.loc.filter((l) => l[LOC.excluida]);
  const nomeLoc = (l: MetaAnuncio["loc"][number]) => {
    const nivel = l[LOC.nivel];
    if (nivel === "municipio") return `${titulo(l[LOC.municipio] ?? "")}${l[LOC.uf] ? `/${l[LOC.uf]}` : ""}`;
    if (nivel === "bairro") return `${L("bairro", "neighborhood")} ${l[LOC.bairro]}${l[LOC.municipio] ? ` (${l[LOC.municipio]})` : L(" (cidade não informada)", " (city not reported)")}`;
    if (nivel === "cep") return `${L("CEP", "ZIP code")} ${l[LOC.cep]}-xxx`;
    if (nivel === "uf") return `${l[LOC.uf] ?? l[LOC.nome]} ${L("(estado)", "(state)")}`;
    if (nivel === "pais") return L("Brasil", "Brazil");
    return l[LOC.nome];
  };
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <b>{a.page_name}</b>
          <span className="text-muted"> · {L("Pago por", "Paid for by")}: {a.bylines ?? L("não informado", "not reported")}</span>
        </div>
        <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-accent">{L("Ver na Biblioteca de Anúncios ↗", "View in Meta Ad Library ↗")}</a>
      </div>
      <div className="text-xs text-muted">
        {L("Veiculação", "Ran")} {fmtData(a.inicio)} – {a.fim ? fmtData(a.fim) : L("em andamento na última coleta", "still running at last collection")} · {L("criado em", "created on")} {fmtData(a.criado)}
        {" · "}{(a.plataformas ?? []).map((p) => titulo(p)).join(", ") || L("plataforma não informada", "platform not reported")}
        {" · "}{L("coletado em", "collected on")} {fmtDataHora(a.ultima_coleta)}
      </div>
      {mencoes?.map((m, i) => {
        const outra = m.outra != null ? base.candById.get(m.outra) : undefined;
        return (
          <div key={i} className={`rounded-md px-2 py-1 text-xs ${m.confirmada ? "bg-accent-soft" : "border border-dashed border-line"}`}>
            {m.papel === "recebe" ? <>{L("Pago por", "Paid for by")} {outra ? <b>{nomeCand(outra)} ({CARGOS[outra.cargo]}, {outra.partido})</b> : <><b>{L("financiador não identificado no TSE", "funder not identified in TSE records")}</b>{(() => { const pv = candidaturaProvavel(base, a.page_name); return pv ? <> · {L("provável", "likely")}: {nomeCand(pv)} ({CARGOS[pv.cargo]}, {pv.partido})</> : null; })()}</>}</>
              : <>{L("Cita", "Mentions")} {outra ? <b>{nomeCand(outra)} ({CARGOS[outra.cargo]}, {outra.partido})</b> : L("outra candidatura", "another candidate")}</>}
            {" · "}{m.cita_nome ? L("nome ✓", "name ✓") : L("sem nome", "no name")} · {m.cita_numero ? L("número ✓", "number ✓") : L("sem número", "no number")}
            {" · "}{m.confirmada ? L("dobrada confirmada", "joint ticket confirmed") : L("não confirmada", "not confirmed")}
            {m.cnpjs_texto && <> · {L("CNPJ no texto", "CNPJ in text")}: {m.cnpjs_texto.split(",").map(fmtCnpj).join(", ")}</>}
            {m.cnpj_financiador && <> · {L("CNPJ do financiador", "Funder CNPJ")}: {m.cnpj_financiador.split(",").map(fmtCnpj).join(", ")}</>}
          </div>
        );
      })}
      {texto ? (
        <p className="whitespace-pre-line">{curto}{texto.length > 320 && (
          <button type="button" className="ml-1 text-accent" onClick={() => setAberto(!aberto)}>{aberto ? L("menos", "less") : L("mais", "more")}</button>
        )}</p>
      ) : <p className="text-muted">{L("(sem texto no anúncio)", "(no text in the ad)")}</p>}
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span>{L("Gasto", "Spend")}: <b>{fmtFaixa(a.gasto[0], a.gasto[1], simbolo(a.moeda ?? ""))}</b></span>
        <span>{L("Impressões", "Impressions")}: <b>{fmtFaixa(a.impressoes[0], a.impressoes[1])}</b></span>
        <span>{L("Custo por mil alcançados", "Cost per 1,000 reached")}: <b>{fmtCusto(custoPorMil([a]))}</b></span>
        <span>{L("Alcance estimado", "Estimated reach")}: <b>{a.alcance != null ? fmtNum(a.alcance, false) : L("não informado", "not reported")}</b></span>
        <span>{L("Público potencial", "Potential audience")}: <b>{fmtFaixa(a.publico[0], a.publico[1])}</b></span>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {inc.map((l, i) => (
          <span key={`i${i}`} title={`${l[LOC.nome]} · ${l[LOC.status]}`}
            className={`rounded px-1.5 py-0.5 ${l[LOC.status] === "validada" || l[LOC.nivel] === "uf" || l[LOC.nivel] === "pais" ? "bg-accent-soft" : "border border-dashed border-line"}`}>
            {nomeLoc(l)}
          </span>
        ))}
        {exc.map((l, i) => (
          <span key={`e${i}`} title={l[LOC.nome]} className="rounded border border-line px-1.5 py-0.5 text-muted line-through">
            {L("excluída", "excluded")}: {nomeLoc(l)}
          </span>
        ))}
        {!a.loc.length && <span className="text-muted">{L("sem localidade informada", "no location reported")}</span>}
      </div>
    </article>
  );
}

const fmtCnpj = (c: string) => (c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c);

interface LinhaParceira {
  chave: string; outra?: Candidatura; paginas: string; paginasLista: string[]; anuncios: number; confirmadas: number; soNome: number;
  gasto: Map<string, Faixa>; cidades: number; inicio: string | null; fim: string | null; cnpjTexto: number;
  custo: { min: number; max: number | null } | null;
}

/** Quem faz dobrada com a candidatura: agrupa as menções por candidatura pagadora (recebe) ou citada (faz). */
function Parceiras({ base, cand, mencoes, fonte, parceira, onParceira }: {
  base: Base; cand: Candidatura; mencoes: MetaMencao[]; fonte: Fonte; parceira: string; onParceira: (p: string) => void;
}) {
  const linhas = useMemo<LinhaParceira[]>(() => {
    const g = new Map<string, MetaMencao[]>();
    for (const m of mencoes) { const k = m.outra == null ? "sem" : String(m.outra); g.set(k, [...(g.get(k) ?? []), m]); }
    return [...g.entries()].map(([chave, ms]) => {
      const ads = [...new Map(ms.map((m) => [m.ad.id, m.ad])).values()];
      const cds = new Set(ads.flatMap((a) => a.loc.filter((l) => !l[LOC.excluida] && l[LOC.cd] && l[LOC.status] === "validada").map((l) => l[LOC.cd])));
      return {
        chave, outra: chave === "sem" ? undefined : base.candById.get(Number(chave)),
        paginas: [...new Set(ads.map((a) => a.page_name ?? a.page_id))].slice(0, 3).join(", "),
        paginasLista: [...new Set(ads.map((a) => a.page_name ?? a.page_id))].slice(0, 3),
        anuncios: ads.length, confirmadas: new Set(ms.filter((m) => m.confirmada).map((m) => m.ad.id)).size,
        soNome: new Set(ms.filter((m) => !m.cita_numero).map((m) => m.ad.id)).size,
        gasto: somaFaixas(ads, "gasto"), cidades: cds.size, custo: custoPorMil(ads),
        inicio: ads.reduce<string | null>((x, a) => (a.inicio && (!x || a.inicio < x) ? a.inicio : x), null),
        fim: ads.reduce<string | null>((x, a) => { const f = a.fim ?? a.ultima_coleta.slice(0, 10); return !x || f > x ? f : x; }, null),
        cnpjTexto: new Set(ms.filter((m) => m.cnpjs_texto).map((m) => m.ad.id)).size,
      };
    }).sort((a, b) => b.anuncios - a.anuncios);
  }, [mencoes, base]);
  if (!linhas.length) return <p className="text-sm text-muted">{L("Nenhuma dobrada encontrada nos anúncios coletados.", "No joint tickets found in the collected ads.")}</p>;
  return (
    <section aria-label={L("Dobradas pagas", "Paid joint-ticket ads")} className="flex flex-col gap-2">
      <h3 className="display text-xl">{fonte === "recebe" ? L(`Campanhas que pagaram anúncios citando ${titulo(cand.nome)}`, `Campaigns that paid for ads mentioning ${titulo(cand.nome)}`) : L(`Candidaturas citadas nos anúncios de ${titulo(cand.nome)}`, `Candidates mentioned in ${titulo(cand.nome)}'s ads`)}</h3>
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted">
            <th className="px-3 py-2">{fonte === "recebe" ? L("Pagou", "Paid") : L("Citada", "Mentioned")}</th><th className="px-3 py-2 text-right">{L("Anúncios", "Ads")}</th>
            <th className="px-3 py-2 text-right">{L("Nome + número", "Name + number")}</th><th className="px-3 py-2 text-right">{L("Só nome", "Name only")}</th>
            <th className="px-3 py-2 text-right">{L("Com CNPJ no texto", "With CNPJ in text")}</th><th className="px-3 py-2 text-right">{L("Gasto (do pagador)", "Spend (by payer)")}</th><th className="px-3 py-2 text-right">{L("Custo por mil alcançados", "Cost per 1,000 reached")}</th>
            <th className="px-3 py-2 text-right">{L("Cidades segmentadas", "Targeted cities")}</th><th className="px-3 py-2">{L("Veiculação", "Run dates")}</th>
          </tr></thead>
          <tbody>{linhas.map((l) => (
            <tr key={l.chave} className={`cursor-pointer border-t border-line hover:bg-accent-soft ${parceira === l.chave ? "bg-accent-soft font-semibold" : ""}`}
              onClick={() => onParceira(parceira === l.chave ? "todas" : l.chave)}>
              <td className="px-3 py-1.5">
                {l.outra ? <>{nomeCand(l.outra)}<SituacaoBadge c={l.outra} compacto /><div className="text-xs font-normal text-muted">{CARGOS[l.outra.cargo]} · {l.outra.partido} · {L("página", "Page")} {l.paginas}</div></>
                  : <>{L("Financiador não identificado no TSE", "Funder not identified in TSE records")}<div className="text-xs font-normal text-muted">{L("páginas", "Pages")}: {l.paginasLista.map((pn) => { const pv = candidaturaProvavel(base, pn); return pv ? `${pn} (${L("provável", "likely")}: ${nomeCand(pv)}, ${CARGOS[pv.cargo]}, ${pv.partido})` : pn; }).join(" · ")}</div></>}
              </td>
              <td className="num px-3 text-right">{fmt(l.anuncios)}</td><td className="num px-3 text-right">{fmt(l.confirmadas)}</td>
              <td className="num px-3 text-right">{fmt(l.soNome)}</td><td className="num px-3 text-right">{fmt(l.cnpjTexto)}</td>
              <td className="num px-3 text-right"><FaixaTxt f={l.gasto} /></td><td className="num whitespace-nowrap px-3 text-right">{fmtCusto(l.custo)}</td><td className="num px-3 text-right">{fmt(l.cidades)}</td>
              <td className="px-3 text-xs">{fmtData(l.inicio)} – {fmtData(l.fim)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {getLang() === "en" ? <>
        Click a row to filter the map, cities and ads by that joint ticket. "Name + number": the text has the ballot name and
        ballot number of the mentioned candidate; the joint ticket is confirmed when, in addition, the declared funder is another
        candidate's campaign CNPJ. The spend belongs to whoever paid (cumulative ranges of these ads) and is not counted in the
        mentioned candidate's spend.
        </> : <>
        Clique numa linha para filtrar mapa, cidades e anúncios por essa dobrada. "Nome + número": o texto traz o nome de urna e o
        número de urna da candidatura citada; a dobrada é confirmada quando, além disso, o financiador declarado é o CNPJ de
        campanha de outra candidatura. O gasto é de quem pagou (faixas acumuladas desses anúncios) e não entra no gasto da
        candidatura citada.
        </>}
      </p>
    </section>
  );
}
