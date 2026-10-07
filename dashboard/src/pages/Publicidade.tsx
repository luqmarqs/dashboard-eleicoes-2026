import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DataTable } from "../components/DataTable";
import { LazyMap } from "../components/LazyMap";
import { ErrorBox, Loading, Segmented, SituacaoBadge, Stat, nomeCand } from "../components/ui";
import { BIVAR, classe, cssRgb, prefersDark, quantis, ramp, type RGB } from "../lib/colors";
import { agregar, porLocal, useBase, useTotais, useVotos, type Base, type LinhaAgregada } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { fmt, normalizar, pct, titulo } from "../lib/format";
import {
  LOC, ROTULO_ABRANGENCIA, abrangencia, circulou, fmtData, fmtDataHora, fmtFaixa, fmtNum, mediana, porMunicipio,
  simbolo, somaFaixas, type Abrangencia, type Faixa, type PorMunicipio,
} from "../lib/meta";
import { source, type MetaAnuncio, type MetaMencao, type MetaResumo } from "../lib/source";
import { CARGOS, type Candidatura } from "../lib/types";
import { deUf, useUf } from "../lib/uf";

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function useMetaResumo() {
  const { uf } = useUf();
  return useQuery({ queryKey: ["meta-resumo", uf], queryFn: () => source.metaResumo(), staleTime: 5 * 60_000 });
}

function useMetaAnuncios(id: number | undefined) {
  const { uf } = useUf();
  return useQuery({ queryKey: ["meta-anuncios", uf, id], queryFn: () => source.metaAnuncios(id!), enabled: id != null,
    staleTime: 5 * 60_000 });
}

function FaixaTxt({ f, prefixo = "" }: { f: Map<string, Faixa>; prefixo?: string }) {
  if (!f.size) return <>não informado</>;
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
        <div className="eyebrow">Biblioteca de Anúncios da Meta · anúncios políticos · candidaturas eleitas {deUf(info)}</div>
        <h1 className="display text-3xl md:text-4xl">Tráfego pago</h1>
        <Cobertura r={r} />
        <details className="max-w-4xl text-sm text-muted">
          <summary className="cursor-pointer text-ink">O que estes dados são — e o que não são</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            <li><b>Segmentação</b>: as localidades que o anunciante escolheu (incluídas ou excluídas). Escolher uma cidade não prova
              que o anúncio foi visto lá.</li>
            <li><b>Entrega</b>: a parcela do alcance de cada anúncio por estado, informada pela Meta. Não existe entrega por cidade
              ou bairro na API.</li>
            <li><b>Votação</b>: resultado do TSE. O cruzamento é descritivo e agregado: mostra onde há coincidência, não que o
              anúncio causou votos.</li>
            <li><b>Gasto e impressões</b> são faixas acumuladas por anúncio (de quando começou até a última coleta). O filtro de
              período escolhe anúncios que circularam no período; não recorta o gasto para o período.</li>
            <li><b>Alcance</b> é estimado por anúncio e não se soma (a mesma pessoa pode ter visto vários anúncios).</li>
          </ul>
        </details>
      </header>

      <TabelaCandidaturas base={b} r={r} selecionada={candId} onEscolher={escolher} />

      {cand && item ? (
        <AnunciosCandidatura key={cand.id} base={b} cand={cand} item={item} />
      ) : (
        <p className="text-muted">Nenhuma candidatura com anúncios coletados {deUf(info)}.</p>
      )}
    </div>
  );
}

function Cobertura({ r }: { r: MetaResumo }) {
  const e = r.execucao;
  if (!e) return <p className="rounded-md border border-line bg-panel px-3 py-2 text-sm">Ainda não há coleta carregada.</p>;
  const parcial = e.status !== "completa";
  return (
    <p className={`max-w-4xl rounded-md border px-3 py-2 text-sm ${parcial ? "border-danger text-danger" : "border-line bg-panel text-muted"}`}>
      Última coleta: <b className="text-ink">{fmtDataHora(e.terminada_em ?? e.iniciada_em)}</b>
      {" · "}{parcial ? <b>coleta {e.status}: {e.paginas_concluidas ?? 0} de {e.paginas_alvo} páginas concluídas</b>
        : <>{e.paginas_concluidas} de {e.paginas_alvo} páginas, paginação concluída</>}
      {" · "}anúncios veiculados desde {fmtData(e.periodo_min)} · Graph API {e.versao_api}
    </p>
  );
}

interface LinhaCand {
  id: number; c: Candidatura; anuncios: number; gmin: number | null; gmax: number | null; aberto: boolean;
  paginas: number; naoConfirmada: boolean;
}

function TabelaCandidaturas({ base, r, selecionada, onEscolher }: {
  base: Base; r: MetaResumo; selecionada?: number; onEscolher: (id: number) => void;
}) {
  const linhas = useMemo<LinhaCand[]>(() => r.candidaturas.flatMap((x) => {
    const c = base.candById.get(x.candidatura_id);
    return c ? [{ id: c.id, c, anuncios: x.anuncios, gmin: x.gasto_min, gmax: x.gasto_max, aberto: !!x.gasto_aberto,
      paginas: x.paginas.length, naoConfirmada: x.paginas.some((p) => p.status_revisao !== "confirmado") }] : [];
  }), [r, base]);
  const eleitas = base.candidaturas.filter((c) => c.tipo === "nominal" && c.situacao?.startsWith("Eleito"));
  const semPagina = eleitas.filter((c) => !r.candidaturas.some((x) => x.candidatura_id === c.id));
  const columns = useMemo<ColumnDef<LinhaCand, unknown>[]>(() => [
    { id: "nome", accessorFn: (l) => l.c.nome, header: "Candidatura", cell: (x) => {
      const l = x.row.original;
      return (
        <button type="button" onClick={() => onEscolher(l.id)} className={`text-left ${l.id === selecionada ? "font-bold text-accent" : "font-semibold hover:text-accent"}`}>
          {nomeCand(l.c)}<SituacaoBadge c={l.c} compacto />
          <div className="text-xs font-normal text-muted">{CARGOS[l.c.cargo]} · {l.c.partido}{l.naoConfirmada ? " · vínculo a revisar" : ""}</div>
        </button>
      );
    } },
    { id: "anuncios", accessorKey: "anuncios", header: "Anúncios", cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "gasto", accessorFn: (l) => l.gmax ?? l.gmin ?? 0, header: "Gasto declarado (faixa)",
      cell: (x) => { const l = x.row.original; return fmtFaixa(l.gmin, l.aberto ? null : l.gmax, "R$ "); }, meta: { numeric: true } },
    { id: "paginas", accessorKey: "paginas", header: "Páginas", meta: { numeric: true } },
  ], [onEscolher, selecionada]);
  const exportCols: ExportCol<LinhaCand>[] = [
    { header: "Número", value: (l) => l.c.numero, type: "number" }, { header: "Candidatura", value: (l) => l.c.nome },
    { header: "Cargo", value: (l) => CARGOS[l.c.cargo] }, { header: "Partido", value: (l) => l.c.partido ?? "" },
    { header: "Anúncios", value: (l) => l.anuncios, type: "number" },
    { header: "Gasto mínimo (soma das faixas, R$)", value: (l) => l.gmin, type: "number" },
    { header: "Gasto máximo (soma das faixas, R$; vazio = sem teto)", value: (l) => (l.aberto ? null : l.gmax), type: "number" },
    { header: "Vínculo a revisar", value: (l) => (l.naoConfirmada ? "sim" : "não") },
  ];
  return (
    <section aria-label="Candidaturas" className="flex flex-col gap-2">
      <h2 className="display text-2xl">Candidaturas</h2>
      <DataTable data={linhas} columns={columns} exportCols={exportCols} nomeArquivo="trafego_pago_candidaturas"
        busca={(l) => `${l.c.numero} ${l.c.nome} ${l.c.partido ?? ""}`} initialSort={[{ id: "gasto", desc: true }]} pageSize={10} />
      <p className="text-xs text-muted">
        Página ligada à candidatura quando o financiador declarado nos anúncios é o CNPJ de campanha dela ("ELEIÇÃO 2026 + nome
        completo no TSE"). {semPagina.length > 0 && <>{fmt(semPagina.length)} de {fmt(eleitas.length)} candidaturas eleitas sem
        página identificada (podem não ter anunciado, ou anunciar com outro financiador).</>}
      </p>
      {semPagina.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Ver eleitas sem página identificada</summary>
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
  const ads = useMetaAnuncios(cand.id);
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
  const filtrados = useMemo(() => todas.filter((a) => circulou(a, de || null, ate || null)
    && (plataforma === "todas" || (a.plataformas ?? []).includes(plataforma))), [todas, de, ate, plataforma]);
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
    const partes = [`${x?.inclui.size ?? 0} anúncio(s) incluem a cidade`];
    if (x?.bairro.size) partes.push(`${x.bairro.size} incluem bairro(s) dela`);
    if (x?.exclui.size) partes.push(`${x.exclui.size} a excluem`);
    return partes.join("<br>");
  }, [mun]);

  if (ads.error) return <ErrorBox error={ads.error} />;
  if (dob.error) return <ErrorBox error={dob.error} />;
  if (!ads.data || !dob.data) return <Loading texto="Carregando anúncios…" />;
  const nRecebe = new Set(mencoes.filter((m) => m.papel === "recebe").map((m) => m.ad.id)).size;
  const nFaz = new Set(mencoes.filter((m) => m.papel === "faz").map((m) => m.ad.id)).size;
  const rotuloGasto = fonte === "proprios" ? "gasto declarado desses anúncios (soma das faixas, acumulado)"
    : fonte === "recebe" ? "gasto das campanhas que pagaram esses anúncios (não é gasto desta candidatura)"
    : "gasto desta candidatura nos anúncios que citam outras";

  const gasto = somaFaixas(lista, "gasto");
  const impr = somaFaixas(lista, "impressoes");
  const alcanceMed = mediana(lista.map((a) => a.alcance).filter((x): x is number => x != null));
  const porAbr = new Map<Abrangencia, number>();
  for (const a of lista) porAbr.set(abrangencia(a), (porAbr.get(abrangencia(a)) ?? 0) + 1);
  const inicio = lista.reduce<string | null>((m, a) => (a.inicio && (!m || a.inicio < m) ? a.inicio : m), null);
  const fim = lista.reduce<string | null>((m, a) => { const f = a.fim ?? a.ultima_coleta.slice(0, 10); return !m || f > m ? f : m; }, null);
  const munNome = municipio ? titulo(base.munByCd.get(municipio)?.nome ?? municipio) : null;

  return (
    <section aria-label={`Anúncios de ${cand.nome}`} className="flex flex-col gap-5 border-t border-line pt-5">
      <header className="flex flex-col gap-1">
        <div className="eyebrow">{CARGOS[cand.cargo]} · {cand.partido}</div>
        <h2 className="display text-2xl md:text-3xl">
          <Link to={`/c/${cand.id}`} className="hover:text-accent">{nomeCand(cand)}</Link><SituacaoBadge c={cand} />
        </h2>
        <ul className="flex flex-wrap gap-2 text-xs">
          {item.paginas.map((p) => (
            <li key={p.page_id} title={p.evidencia ?? ""}
              className={`rounded border px-2 py-0.5 ${p.status_revisao === "confirmado" ? "border-line" : "border-danger text-danger"}`}>
              Página “{p.page_name}” · {p.status_revisao === "confirmado" ? "vínculo confirmado (financiador)" : "vínculo NÃO confirmado — a revisar"}
            </li>
          ))}
        </ul>
      </header>

      <Segmented label="Fonte dos anúncios" value={fonte} onChange={(f) => { setFonte(f); setParceira("todas"); setMunicipio(null); }} options={[
        { id: "proprios", label: `Anúncios próprios (${fmt(proprios.length)})` },
        { id: "recebe", label: `Dobradas: outras campanhas citam (${fmt(nRecebe)})` },
        { id: "faz", label: `Dobradas: cita outras (${fmt(nFaz)})` },
      ]} />
      {fonte !== "proprios" && (
        <Parceiras base={base} cand={cand} mencoes={mencoesFonte} fonte={fonte} parceira={parceira} onParceira={setParceira} />
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-panel p-3 text-sm">
        <label className="flex flex-col gap-1 text-muted">Circulou a partir de
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1 text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-muted">até
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1 text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-muted">Plataforma
          <Segmented label="Plataforma" value={plataforma} onChange={setPlataforma}
            options={[{ id: "todas", label: "Todas" }, ...plataformas.map((p) => ({ id: p, label: titulo(p.replace(/_/g, " ")) }))]} />
        </label>
        <label htmlFor="pub-mun" className="flex flex-col gap-1 text-muted">Cidade segmentada
          <select id="pub-mun" value={municipio ?? ""} onChange={(e) => setMunicipio(e.target.value || null)}
            className="rounded-md border border-line bg-panel px-2 py-1 text-ink">
            <option value="">Todas</option>
            {[...mun.values()].filter((x) => x.inclui.size + x.bairro.size > 0 && base.munByCd.has(x.cd))
              .sort((a, b) => (b.inclui.size + b.bairro.size) - (a.inclui.size + a.bairro.size))
              .map((x) => <option key={x.cd} value={x.cd}>{titulo(base.munByCd.get(x.cd)!.nome)} ({x.inclui.size + x.bairro.size})</option>)}
          </select>
        </label>
        {(de || ate || plataforma !== "todas" || municipio) && (
          <button type="button" onClick={() => { setDe(""); setAte(""); setPlataforma("todas"); setMunicipio(null); }}
            className="rounded-md border border-line px-3 py-1 hover:bg-accent-soft">Limpar</button>
        )}
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Stat valor={fmt(lista.length)} rotulo={<>anúncios{municipio ? <> que incluem {munNome}</> : null}{lista.length !== todas.length ? ` (de ${fmt(todas.length)})` : ""}</>} />
        <Stat valor={<FaixaTxt f={gasto} />} rotulo={rotuloGasto} />
        <Stat valor={<FaixaTxt f={impr} prefixo=" " />} rotulo="impressões (soma das faixas)" />
        <Stat valor={alcanceMed != null ? fmtNum(alcanceMed) : "–"} rotulo="alcance estimado por anúncio (mediana; não se soma)" />
        <Stat valor={`${fmtData(inicio)} – ${fmtData(fim)}`} rotulo="veiculação" />
      </div>
      {municipio && (
        <p className="text-xs text-muted">
          O gasto acima é o total desses anúncios em todos os lugares em que circularam, não o gasto em {munNome}: a Meta não
          informa gasto por cidade.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-2">
          <Segmented label="O que o mapa mostra" value={modo} onChange={setModo} options={[
            { id: "segmentacao", label: "Segmentação" }, { id: "votacao", label: "Votação" }, { id: "cruzamento", label: "Segmentação × votação" },
          ]} />
          {pl ? (
            <LazyMap base={base} dados={pl} municipio={null} modo="municipios" metrica="pct" corPorMunicipio={corPorMunicipio}
              infoExtra={infoExtra} rotuloSerie={`votos de ${titulo(cand.nome)}`} onMunicipio={(cd) => setMunicipio(cd)} altura="min(62vh, 640px)" />
          ) : <Loading texto="Carregando votação…" />}
          <LegendaPub modo={modo} breaks={breaksSeg} breaksVoto={breaksVoto} excluida={EXCLUIDA} vazio={VAZIO} />
          <p className="text-xs text-muted">
            Segmentação por cidade (ou por bairro com cidade identificada) {deUf(info)}; anúncios que miram o estado inteiro não
            pintam cidades. Clique numa cidade para ver os anúncios que a incluem.
          </p>
        </div>
        <aside className="flex flex-col gap-4">
          <div>
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide">Recorte geográfico escolhido</h3>
            <ul className="text-sm">
              {(["municipio", "bairro", "cep", "uf", "pais", "desconhecida", "sem_segmentacao"] as Abrangencia[])
                .filter((k) => porAbr.get(k)).map((k) => (
                  <li key={k} className="flex justify-between border-b border-line py-1">
                    <span>{ROTULO_ABRANGENCIA[k]}</span><span className="num">{fmt(porAbr.get(k)!)} anúncios</span>
                  </li>
                ))}
            </ul>
            <p className="mt-1 text-xs text-muted">Recorte mais fino entre as localidades incluídas de cada anúncio.</p>
          </div>
          <Entrega ads={lista} />
        </aside>
      </div>

      <Efetividade base={base} mun={mun} votosMun={votosMun} ads={filtrados} cand={cand} onMunicipio={setMunicipio} />

      <section aria-label="Lista de anúncios" className="flex flex-col gap-3">
        <h3 className="display text-xl">Anúncios{municipio ? ` que incluem ${munNome}` : ""}</h3>
        {lista.slice(0, mostrar).map((a) => <CardAnuncio key={a.id} a={a} mencoes={mencaoPorAd.get(a.id)} base={base} />)}
        {lista.length > mostrar && (
          <button type="button" onClick={() => setMostrar((m) => m + 20)}
            className="self-start rounded-md border border-line px-3 py-1.5 text-sm hover:bg-accent-soft">
            Mostrar mais ({fmt(lista.length - mostrar)} restantes)
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
    itens = [sw(vazio, "nenhum anúncio inclui"), sw(excluida, "só excluída"),
      ...[...new Set(lim)].slice(0, 6).map((v, i, arr) => sw(r[Math.min(i + 1, r.length - 1)], i === arr.length - 1 ? `${v}+ anúncios` : `${v}${arr[i + 1] - 1 > v ? `–${arr[i + 1] - 1}` : ""}`))];
  } else if (modo === "votacao") {
    itens = r.map((c, i) => sw(c, i === 0 ? `até ${pct(breaksVoto[0] ?? 0, 1)}` : `${pct(breaksVoto[i - 1] ?? 0, 1)}+`));
  } else {
    itens = [sw(BIVAR[2][2], "segmentada · votação alta"), sw(BIVAR[2][1], "segmentada · média"), sw(BIVAR[2][0], "segmentada · baixa"),
      sw(BIVAR[0][2], "não segmentada · votação alta"), sw(BIVAR[0][1], "não segmentada · média"), sw(BIVAR[0][0], "não segmentada · baixa")];
  }
  return <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda">{itens}</div>;
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
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wide">Entrega (onde a Meta diz que chegou)</h3>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="py-1">Região</th><th className="text-right">Anúncios</th><th className="text-right">Mediana do alcance</th></tr></thead>
        <tbody>
          {linhas.ufs.slice(0, 8).map((l) => (
            <tr key={l.uf} className="border-t border-line"><td className="py-1">{l.uf}</td><td className="num text-right">{fmt(l.n)}</td><td className="num text-right">{l.med > 0 && l.med < 0.01 ? "<1%" : pct(l.med, 0)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-muted">
        Parcela do alcance de cada anúncio por estado (só há este nível). {linhas.sem > 0 && `${fmt(linhas.sem)} anúncios sem distribuição informada.`}
      </p>
    </div>
  );
}

interface LinhaEf { cd: string; nome: string; inclui: number; bairro: number; exclui: number; inicio: string | null; fim: string | null;
  gmin: number; gmax: number | null; votos: number; validos: number; pct: number }

function Efetividade({ base, mun, votosMun, ads, cand, onMunicipio }: {
  base: Base; mun: Map<string, PorMunicipio>; votosMun: Map<string, LinhaAgregada>; ads: MetaAnuncio[]; cand: Candidatura;
  onMunicipio: (cd: string) => void;
}) {
  const porId = useMemo(() => new Map(ads.map((a) => [a.id, a])), [ads]);
  const total = useMemo(() => [...votosMun.values()].reduce((s, l) => s + l.votos, 0), [votosMun]);
  const linhas = useMemo<LinhaEf[]>(() => base.municipios.map((m) => {
    const x = mun.get(m.cd);
    const ids = new Set([...(x?.inclui ?? []), ...(x?.bairro ?? [])]);
    const g = somaFaixas([...ids].map((i) => porId.get(i)!).filter(Boolean), "gasto").get("BRL");
    const v = votosMun.get(m.cd);
    return { cd: m.cd, nome: m.nome, inclui: x?.inclui.size ?? 0, bairro: x?.bairro.size ?? 0, exclui: x?.exclui.size ?? 0,
      inicio: x?.inicio ?? null, fim: x?.fim ?? null, gmin: g?.min ?? 0, gmax: g ? g.max : 0,
      votos: v?.votos ?? 0, validos: v?.validos ?? 0, pct: v?.pct ?? 0 };
  }), [base, mun, porId, votosMun]);

  const grupos = useMemo(() => {
    const g = (f: (l: LinhaEf) => boolean) => {
      const ls = linhas.filter(f);
      const votos = ls.reduce((s, l) => s + l.votos, 0), val = ls.reduce((s, l) => s + l.validos, 0);
      return { n: ls.length, votos, pct: val ? votos / val : 0, share: total ? votos / total : 0 };
    };
    return [
      { t: "Cidades incluídas na segmentação (cidade inteira)", ...g((l) => l.inclui > 0) },
      { t: "Cidades só com bairros segmentados", ...g((l) => l.inclui === 0 && l.bairro > 0) },
      { t: "Cidades sem segmentação explícita", ...g((l) => l.inclui === 0 && l.bairro === 0) },
    ];
  }, [linhas, total]);

  const columns = useMemo<ColumnDef<LinhaEf, unknown>[]>(() => [
    { id: "nome", accessorKey: "nome", header: "Município", cell: (x) => (
      <button type="button" className="text-left font-semibold hover:text-accent" onClick={() => onMunicipio(x.row.original.cd)}>{titulo(x.row.original.nome)}</button>
    ) },
    { id: "inclui", accessorKey: "inclui", header: "Anúncios que incluem", cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "bairro", accessorKey: "bairro", header: "…via bairro", cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "exclui", accessorKey: "exclui", header: "Que excluem", cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "gasto", accessorFn: (l) => l.gmax ?? l.gmin, header: "Gasto total desses anúncios*",
      cell: (x) => { const l = x.row.original; return l.inclui + l.bairro ? fmtFaixa(l.gmin, l.gmax, "R$ ") : "–"; }, meta: { numeric: true } },
    { id: "periodo", accessorFn: (l) => l.inicio ?? "", header: "Veiculação", cell: (x) => { const l = x.row.original; return l.inicio ? `${fmtData(l.inicio)} – ${fmtData(l.fim)}` : "–"; } },
    { id: "votos", accessorKey: "votos", header: "Votos", cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "pct", accessorKey: "pct", header: "% válidos", cell: (x) => pct(Number(x.getValue())), meta: { numeric: true } },
    { id: "share", accessorFn: (l) => (total ? l.votos / total : 0), header: "% do total", cell: (x) => pct(Number(x.getValue())), meta: { numeric: true } },
  ], [onMunicipio, total]);
  const exportCols: ExportCol<LinhaEf>[] = [
    { header: "Município", value: (l) => l.nome }, { header: "Código TSE", value: (l) => l.cd },
    { header: "Anúncios que incluem a cidade", value: (l) => l.inclui, type: "number" },
    { header: "Anúncios que incluem bairro da cidade", value: (l) => l.bairro, type: "number" },
    { header: "Anúncios que excluem a cidade", value: (l) => l.exclui, type: "number" },
    { header: "Gasto total dos anúncios associados - mínimo (não é gasto na cidade)", value: (l) => (l.inclui + l.bairro ? l.gmin : null), type: "number" },
    { header: "Gasto total dos anúncios associados - máximo (vazio = sem teto)", value: (l) => (l.inclui + l.bairro ? l.gmax : null), type: "number" },
    { header: "Primeira veiculação", value: (l) => l.inicio ?? "" }, { header: "Última veiculação", value: (l) => l.fim ?? "" },
    { header: "Votos", value: (l) => l.votos, type: "number" }, { header: "% válidos", value: (l) => l.pct, type: "percent" },
    { header: "% do total da candidatura", value: (l) => (total ? l.votos / total : 0), type: "percent" },
  ];
  return (
    <section aria-label="Segmentação e votação" className="flex flex-col gap-3">
      <h3 className="display text-xl">Segmentação e votação</h3>
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted">
            <th className="px-3 py-2">Grupo de cidades</th><th className="px-3 py-2 text-right">Cidades</th>
            <th className="px-3 py-2 text-right">Votos de {titulo(cand.nome)}</th><th className="px-3 py-2 text-right">% do total</th>
            <th className="px-3 py-2 text-right">% dos válidos no grupo</th>
          </tr></thead>
          <tbody>{grupos.map((g) => (
            <tr key={g.t} className="border-t border-line">
              <td className="px-3 py-1.5">{g.t}</td><td className="num px-3 text-right">{fmt(g.n)}</td>
              <td className="num px-3 text-right">{fmt(g.votos)}</td><td className="num px-3 text-right">{pct(g.share, 1)}</td>
              <td className="num px-3 text-right">{pct(g.pct)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Comparação descritiva: as cidades escolhidas pelo anunciante tendem a ser onde a candidatura já é forte (capital, base
        eleitoral), então diferença de votação entre os grupos <b>não mede o efeito</b> dos anúncios. Segmentar uma cidade também não
        garante que o anúncio foi entregue lá.
      </p>
      <DataTable data={linhas} columns={columns} exportCols={exportCols} nomeArquivo={`trafego_pago_${cand.numero}_municipios`}
        busca={(l) => normalizar(l.nome)} initialSort={[{ id: "inclui", desc: true }]} pageSize={15}
        atalhos={[
          { label: "Mais anúncios", sort: [{ id: "inclui", desc: true }] },
          { label: "Mais votos", sort: [{ id: "votos", desc: true }] },
          { label: "Maior % válidos", sort: [{ id: "pct", desc: true }] },
        ]} />
      <p className="text-xs text-muted">
        * Gasto total (faixa acumulada) dos anúncios que incluem a cidade, somando o que gastaram em todos os lugares. Não é o
        gasto na cidade, e o mesmo anúncio aparece em todas as cidades que ele inclui.
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
    if (nivel === "bairro") return `bairro ${l[LOC.bairro]}${l[LOC.municipio] ? ` (${l[LOC.municipio]})` : " (cidade não informada)"}`;
    if (nivel === "cep") return `CEP ${l[LOC.cep]}-xxx`;
    if (nivel === "uf") return `${l[LOC.uf] ?? l[LOC.nome]} (estado)`;
    if (nivel === "pais") return "Brasil";
    return l[LOC.nome];
  };
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <b>{a.page_name}</b>
          <span className="text-muted"> · Pago por: {a.bylines ?? "não informado"}</span>
        </div>
        <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-accent">Ver na Biblioteca de Anúncios ↗</a>
      </div>
      <div className="text-xs text-muted">
        Veiculação {fmtData(a.inicio)} – {a.fim ? fmtData(a.fim) : "em andamento na última coleta"} · criado em {fmtData(a.criado)}
        {" · "}{(a.plataformas ?? []).map((p) => titulo(p)).join(", ") || "plataforma não informada"}
        {" · "}coletado em {fmtDataHora(a.ultima_coleta)}
      </div>
      {mencoes?.map((m, i) => {
        const outra = m.outra != null ? base.candById.get(m.outra) : undefined;
        return (
          <div key={i} className={`rounded-md px-2 py-1 text-xs ${m.confirmada ? "bg-accent-soft" : "border border-dashed border-line"}`}>
            {m.papel === "recebe" ? <>Pago por {outra ? <b>{nomeCand(outra)} ({CARGOS[outra.cargo]}, {outra.partido})</b> : <b>financiador não identificado no TSE</b>}</>
              : <>Cita {outra ? <b>{nomeCand(outra)} ({CARGOS[outra.cargo]}, {outra.partido})</b> : "outra candidatura"}</>}
            {" · "}{m.cita_nome ? "nome ✓" : "sem nome"} · {m.cita_numero ? "número ✓" : "sem número"}
            {" · "}{m.confirmada ? "dobrada confirmada" : "não confirmada"}
            {m.cnpjs_texto && <> · CNPJ no texto: {m.cnpjs_texto.split(",").map(fmtCnpj).join(", ")}</>}
            {m.cnpj_financiador && <> · CNPJ do financiador: {m.cnpj_financiador.split(",").map(fmtCnpj).join(", ")}</>}
          </div>
        );
      })}
      {texto ? (
        <p className="whitespace-pre-line">{curto}{texto.length > 320 && (
          <button type="button" className="ml-1 text-accent" onClick={() => setAberto(!aberto)}>{aberto ? "menos" : "mais"}</button>
        )}</p>
      ) : <p className="text-muted">(sem texto no anúncio)</p>}
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span>Gasto: <b>{fmtFaixa(a.gasto[0], a.gasto[1], simbolo(a.moeda ?? ""))}</b></span>
        <span>Impressões: <b>{fmtFaixa(a.impressoes[0], a.impressoes[1])}</b></span>
        <span>Alcance estimado: <b>{a.alcance != null ? fmtNum(a.alcance, false) : "não informado"}</b></span>
        <span>Público potencial: <b>{fmtFaixa(a.publico[0], a.publico[1])}</b></span>
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
            excluída: {nomeLoc(l)}
          </span>
        ))}
        {!a.loc.length && <span className="text-muted">sem localidade informada</span>}
      </div>
    </article>
  );
}

const fmtCnpj = (c: string) => (c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c);

interface LinhaParceira {
  chave: string; outra?: Candidatura; paginas: string; anuncios: number; confirmadas: number; soNome: number;
  gasto: Map<string, Faixa>; cidades: number; inicio: string | null; fim: string | null; cnpjTexto: number;
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
        anuncios: ads.length, confirmadas: new Set(ms.filter((m) => m.confirmada).map((m) => m.ad.id)).size,
        soNome: new Set(ms.filter((m) => !m.cita_numero).map((m) => m.ad.id)).size,
        gasto: somaFaixas(ads, "gasto"), cidades: cds.size,
        inicio: ads.reduce<string | null>((x, a) => (a.inicio && (!x || a.inicio < x) ? a.inicio : x), null),
        fim: ads.reduce<string | null>((x, a) => { const f = a.fim ?? a.ultima_coleta.slice(0, 10); return !x || f > x ? f : x; }, null),
        cnpjTexto: new Set(ms.filter((m) => m.cnpjs_texto).map((m) => m.ad.id)).size,
      };
    }).sort((a, b) => b.anuncios - a.anuncios);
  }, [mencoes, base]);
  if (!linhas.length) return <p className="text-sm text-muted">Nenhuma dobrada encontrada nos anúncios coletados.</p>;
  return (
    <section aria-label="Dobradas pagas" className="flex flex-col gap-2">
      <h3 className="display text-xl">{fonte === "recebe" ? `Campanhas que pagaram anúncios citando ${titulo(cand.nome)}` : `Candidaturas citadas nos anúncios de ${titulo(cand.nome)}`}</h3>
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted">
            <th className="px-3 py-2">{fonte === "recebe" ? "Pagou" : "Citada"}</th><th className="px-3 py-2 text-right">Anúncios</th>
            <th className="px-3 py-2 text-right">Nome + número</th><th className="px-3 py-2 text-right">Só nome</th>
            <th className="px-3 py-2 text-right">Com CNPJ no texto</th><th className="px-3 py-2 text-right">Gasto (do pagador)</th>
            <th className="px-3 py-2 text-right">Cidades segmentadas</th><th className="px-3 py-2">Veiculação</th>
          </tr></thead>
          <tbody>{linhas.map((l) => (
            <tr key={l.chave} className={`cursor-pointer border-t border-line hover:bg-accent-soft ${parceira === l.chave ? "bg-accent-soft font-semibold" : ""}`}
              onClick={() => onParceira(parceira === l.chave ? "todas" : l.chave)}>
              <td className="px-3 py-1.5">
                {l.outra ? <>{nomeCand(l.outra)}<SituacaoBadge c={l.outra} compacto /><div className="text-xs font-normal text-muted">{CARGOS[l.outra.cargo]} · {l.outra.partido} · página {l.paginas}</div></>
                  : <>Financiador não identificado no TSE<div className="text-xs font-normal text-muted">páginas: {l.paginas}</div></>}
              </td>
              <td className="num px-3 text-right">{fmt(l.anuncios)}</td><td className="num px-3 text-right">{fmt(l.confirmadas)}</td>
              <td className="num px-3 text-right">{fmt(l.soNome)}</td><td className="num px-3 text-right">{fmt(l.cnpjTexto)}</td>
              <td className="num px-3 text-right"><FaixaTxt f={l.gasto} /></td><td className="num px-3 text-right">{fmt(l.cidades)}</td>
              <td className="px-3 text-xs">{fmtData(l.inicio)} – {fmtData(l.fim)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Clique numa linha para filtrar mapa, cidades e anúncios por essa dobrada. "Nome + número": o texto traz o nome de urna e o
        número de urna da candidatura citada; a dobrada é confirmada quando, além disso, o financiador declarado é o CNPJ de
        campanha de outra candidatura. O gasto é de quem pagou (faixas acumuladas desses anúncios) e não entra no gasto da
        candidatura citada.
      </p>
    </section>
  );
}
