import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { DataTable, TituloTabela } from "../components/DataTable";
import { LazyMap } from "../components/LazyMap";
import { ErrorBox, Loading, Segmented, SituacaoBadge, nomeCand } from "../components/ui";
import { BLOCOS, PADRAO, blocoDe, lerBlocos, salvarBlocos, zeroPorBloco, type Bloco } from "../lib/blocos";
import { cssRgb, prefersDark, type RGB } from "../lib/colors";
import { useBase, type Base, type PorLocal } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { dec, fmt, pct, titulo } from "../lib/format";
import { L, getLang } from "../lib/i18n";
import { fmtCusto, fmtFaixa } from "../lib/meta";
import { useMetaResumo } from "../lib/metaHooks";
import { source, type Apocalipse as DadosApoc, type MetaResumo, type MetaTemas } from "../lib/source";
import { EIXOS, rotuloDe } from "../lib/temas";
import { CARGOS, type Candidatura } from "../lib/types";
import { useUf } from "../lib/uf";

/*
 * Apocalipse: esquerda × centrão × extrema direita no estado. Votos e eleitos (TSE), território (margem por cidade), tráfego pago
 * dos eleitos (Biblioteca de Anúncios da Meta: só candidaturas eleitas foram coletadas) e temas dos criativos.
 * Tom direto, números exatos; cruzamentos descritivos.
 */

const CARGOS_APOC = [1, 3, 5, 6, 7];
const en = () => getLang() === "en";
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// esquerda = roxo (identidade do painel); centrão = verde; extrema direita = laranja; validados para daltonismo
const COR = () => (prefersDark()
  ? { esquerda: hex("#a466d0"), centrao: hex("#3ba673"), extrema: hex("#c47c22"), demais: hex("#5c5463"), div: ["#c47c22", "#7a5a3a", "#3a343f", "#7a4f9a", "#b37ad9"].map(hex) }
  : { esquerda: hex("#7b1fa2"), centrao: hex("#2a9d5c"), extrema: hex("#c86a00"), demais: hex("#b9b3bd"), div: ["#c86a00", "#eab27a", "#e6e2e8", "#b98ad6", "#6a2399"].map(hex) });
const NOME_BLOCO = (b: Bloco) => (b === "esquerda" ? L("Esquerda", "Left") : b === "centrao" ? L("Centrão", "Centrão")
  : b === "extrema" ? L("Extrema direita", "Far right") : L("Demais", "Others"));

function useApoc() {
  const { uf } = useUf();
  return useQuery({ queryKey: ["apocalipse", uf], queryFn: () => source.apocalipse(), staleTime: Infinity });
}
function useTemas() {
  const { uf } = useUf();
  return useQuery({ queryKey: ["meta-temas", uf], queryFn: () => source.metaTemas(), staleTime: 10 * 60_000 });
}

export function Apocalipse() {
  const base = useBase();
  const apoc = useApoc();
  const resumo = useMetaResumo();
  const temas = useTemas();
  const [blocos, setBlocosState] = useState<Record<string, Bloco>>(lerBlocos);
  const setBlocos = (b: Record<string, Bloco>) => { setBlocosState(b); salvarBlocos(b); };

  if (base.error) return <ErrorBox error={base.error} />;
  if (apoc.error) return <ErrorBox error={apoc.error} />;
  if (!base.data || apoc.isLoading) return <Loading />;
  if (!apoc.data) return <p className="text-muted">{L("Dados do Apocalipse ainda não gerados para este estado.", "Apocalypse data not generated for this state yet.")}</p>;
  return <Painel base={base.data} apoc={apoc.data} resumo={resumo.data} temas={temas.data} blocos={blocos} setBlocos={setBlocos} />;
}

interface Placar { cargo: number; validos: number; votos: Record<Bloco, number>; eleitos: Record<Bloco, number>; segundo: Record<Bloco, number> }

function Painel({ base, apoc, resumo, temas, blocos, setBlocos }: {
  base: Base; apoc: DadosApoc; resumo?: MetaResumo; temas?: MetaTemas; blocos: Record<string, Bloco>; setBlocos: (b: Record<string, Bloco>) => void;
}) {
  const { info } = useUf();
  const [cargoMapa, setCargoMapa] = useState(6);
  const cor = COR();

  // ---- placar por cargo ----
  const placar = useMemo<Placar[]>(() => CARGOS_APOC.map((cargo) => {
    const votos = zeroPorBloco();
    apoc.votos.cargo.forEach((c, i) => { if (c === cargo) votos[blocoDe(blocos, apoc.votos.partido[i])] += apoc.votos.votos[i]; });
    let validos = 0;
    apoc.validos.cargo.forEach((c, i) => { if (c === cargo) validos += apoc.validos.validos[i]; });
    const eleitos = zeroPorBloco();
    const segundo = zeroPorBloco();
    for (const c of base.candidaturas) {
      if (c.cargo !== cargo || c.tipo !== "nominal") continue;
      if (c.situacao?.startsWith("Eleito")) eleitos[blocoDe(blocos, c.partido)]++;
      if (c.situacao === "2º turno") segundo[blocoDe(blocos, c.partido)]++;
    }
    return { cargo, validos, votos, eleitos, segundo };
  }).filter((p) => p.validos > 0), [apoc, base, blocos]);

  // ---- território: margem por cidade no cargo escolhido ----
  const porMun = useMemo(() => {
    const m = new Map<string, { esq: number; cen: number; ext: number; dem: number; val: number }>();
    apoc.votos.cargo.forEach((c, i) => {
      if (c !== cargoMapa) return;
      const k = apoc.votos.mun[i];
      const x = m.get(k) ?? { esq: 0, cen: 0, ext: 0, dem: 0, val: 0 };
      const b = blocoDe(blocos, apoc.votos.partido[i]);
      if (b === "esquerda") x.esq += apoc.votos.votos[i]; else if (b === "centrao") x.cen += apoc.votos.votos[i]; else if (b === "extrema") x.ext += apoc.votos.votos[i]; else x.dem += apoc.votos.votos[i];
      m.set(k, x);
    });
    apoc.validos.cargo.forEach((c, i) => { if (c === cargoMapa) { const x = m.get(apoc.validos.mun[i]); if (x) x.val += apoc.validos.validos[i]; } });
    return m;
  }, [apoc, blocos, cargoMapa]);
  const corPorMunicipio = useCallback((cd: string): RGB | null => {
    const x = porMun.get(cd);
    if (!x || !x.val) return null;
    const d = (x.esq - x.ext) / x.val;
    return d <= -0.2 ? cor.div[0] : d < -0.05 ? cor.div[1] : d <= 0.05 ? cor.div[2] : d < 0.2 ? cor.div[3] : cor.div[4];
  }, [porMun, cor]);
  const infoExtra = useCallback(({ municipio: cd }: { municipio?: string }) => {
    const x = cd ? porMun.get(cd) : undefined;
    if (!x || !x.val) return null;
    return `${NOME_BLOCO("esquerda")}: ${pct(x.esq / x.val, 1)} · ${NOME_BLOCO("centrao")}: ${pct(x.cen / x.val, 1)} · ${NOME_BLOCO("extrema")}: ${pct(x.ext / x.val, 1)}`;
  }, [porMun]);
  const vazio = useMemo<PorLocal>(() => ({ votos: new Float64Array(base.locais.length), validos: new Float64Array(base.locais.length), total: 0, totalValidos: 0 }), [base]);

  const cidades = useMemo(() => [...porMun.entries()].filter(([, x]) => x.val > 0).map(([cd, x]) => ({
    cd, nome: base.munByCd.get(cd)?.nome ?? cd, val: x.val, esq: x.esq / x.val, cen: x.cen / x.val, ext: x.ext / x.val, margem: (x.esq - x.ext) / x.val,
  })), [porMun, base]);
  const vitorias = { esquerda: cidades.filter((c) => c.margem > 0).length, extrema: cidades.filter((c) => c.margem < 0).length };
  // cidades em que o centrão teve mais votos que esquerda e extrema direita
  const centraoLidera = cidades.filter((c) => c.cen > c.esq && c.cen > c.ext).length;

  // ---- tráfego pago dos eleitos ----
  const trafego = useMemo(() => {
    const porId = new Map((resumo?.candidaturas ?? []).map((c) => [c.candidatura_id, c]));
    const tot = {} as Record<Bloco, { eleitos: number; comAnuncio: number; anuncios: number; gmin: number; gmax: number | null; cgmin: number; cgmax: number | null; alc: number; votos: number; votosComAnuncio: number }>;
    for (const b of BLOCOS) tot[b] = { eleitos: 0, comAnuncio: 0, anuncios: 0, gmin: 0, gmax: 0, cgmin: 0, cgmax: 0, alc: 0, votos: 0, votosComAnuncio: 0 };
    for (const c of base.candidaturas) {
      if (c.tipo !== "nominal" || !c.situacao?.startsWith("Eleito") || ![3, 5, 6, 7].includes(c.cargo)) continue;
      const b = blocoDe(blocos, c.partido), t = tot[b], r = porId.get(c.id);
      t.eleitos++; t.votos += c.votos;
      if (!r || !r.anuncios) continue;
      t.comAnuncio++; t.anuncios += r.anuncios; t.votosComAnuncio += c.votos;
      t.gmin += r.gasto_min ?? 0; t.gmax = t.gmax == null || r.gasto_max == null || r.gasto_aberto ? null : t.gmax + r.gasto_max;
      if (r.c_alc) { t.cgmin += r.c_gmin ?? 0; t.cgmax = t.cgmax == null || r.c_aberto ? null : t.cgmax + (r.c_gmax ?? 0); t.alc += r.c_alc; }
    }
    return tot;
  }, [resumo, base, blocos]);

  // ---- temas por bloco (eleitos) ----
  const temasBloco = useMemo(() => {
    const eleitos = new Map(base.candidaturas.filter((c) => c.situacao?.startsWith("Eleito")).map((c) => [c.id, c]));
    const out = {} as Record<Bloco, { total: number; por: Map<string, number> }>;
    for (const b of BLOCOS) out[b] = { total: 0, por: new Map() };
    const vistos = new Set<number>();
    temas?.cand.forEach((cid, i) => {
      const c = eleitos.get(cid);
      if (!c) return;
      const o = out[blocoDe(blocos, c.partido)];
      if (!vistos.has(cid)) { vistos.add(cid); o.total += temas.total[i]; }
      o.por.set(temas.tema[i], (o.por.get(temas.tema[i]) ?? 0) + temas.criativos[i]);
    });
    return out;
  }, [temas, base, blocos]);

  const custo = (t: { cgmin: number; cgmax: number | null; alc: number }) => (t.alc ? { min: t.cgmin / t.alc * 1000, max: t.cgmax == null ? null : t.cgmax / t.alc * 1000 } : null);
  const porVoto = (t: { gmin: number; gmax: number | null; votosComAnuncio: number }) => (t.votosComAnuncio ? { min: t.gmin / t.votosComAnuncio, max: t.gmax == null ? null : t.gmax / t.votosComAnuncio } : null);
  const fmtRS = (x: { min: number; max: number | null } | null) => (x ? fmtCusto(x) : "–");

  // ---- leitura apocalíptica ----
  const leitura: ReactNode[] = [];
  const dep = placar.find((p) => p.cargo === 6), est = placar.find((p) => p.cargo === 7), sen = placar.find((p) => p.cargo === 5);
  const gov = placar.find((p) => p.cargo === 3), pres = placar.find((p) => p.cargo === 1);
  const vencedores = (cargo: number) => base.candidaturas.filter((c) => c.cargo === cargo && c.tipo === "nominal" && (c.situacao?.startsWith("Eleito") || c.situacao === "2º turno"))
    .sort((a, b2) => b2.votos - a.votos).map((c) => `${titulo(c.nome)} (${c.partido}, ${NOME_BLOCO(blocoDe(blocos, c.partido)).toLowerCase()})`);
  const linhaPlacar = (p: Placar | undefined, rot: string) => {
    if (!p) return;
    const sh = (b: Bloco) => pct(p.votos[b] / p.validos, 1);
    const quem = [1, 3, 5].includes(p.cargo) ? vencedores(p.cargo) : [];
    const tres: Bloco[] = ["extrema", "centrao", "esquerda"];
    const ordem = tres.filter((b) => p.votos[b] > 0).sort((a, b2) => p.votos[b2] - p.votos[a]);
    const ausentes = tres.filter((b) => !p.votos[b]);
    const d = (p.votos.extrema - p.votos.esquerda) / p.validos * 100;
    const duelo = p.votos.esquerda && p.votos.extrema
      ? (d >= 0 ? L(` (extrema direita ${dec(d, 1)} p.p. à frente da esquerda)`, ` (far right ${dec(d, 1)} pp ahead of the left)`)
        : L(` (esquerda ${dec(-d, 1)} p.p. à frente da extrema direita)`, ` (left ${dec(-d, 1)} pp ahead of the far right)`))
      : "";
    const nm = (b: Bloco) => NOME_BLOCO(b).toLowerCase();
    const votosTxt = ordem.map((b) => `${nm(b)} ${sh(b)}`).join(", ");
    const elTxt = (x: Record<Bloco, number>) => ordem.map((b) => `${nm(b)} ${x[b]}`).join(", ");
    const totEl = BLOCOS.reduce((a, b) => a + p.eleitos[b], 0);
    const totSeg = BLOCOS.reduce((a, b) => a + p.segundo[b], 0);
    const semCand = ausentes.length
      ? L(` Sem candidatura (pela classificação atual): ${ausentes.map(nm).join(", ")}.`, ` No candidacy (current classification): ${ausentes.map(nm).join(", ")}.`)
      : "";
    leitura.push(en()
      ? <><b>{rot}:</b> {votosTxt} of valid votes{duelo}{totEl || !totSeg ? `; elected: ${elTxt(p.eleitos)}` : ""}{totSeg ? `; runoff: ${elTxt(p.segundo)}` : ""}.{semCand}{quem.length ? <> {p.cargo === 5 ? "Elected" : totEl ? "Winner" : "In the runoff"}: {quem.join("; ")}.</> : null}</>
      : <><b>{rot}:</b> {votosTxt} dos válidos{duelo}{totEl || !totSeg ? `; eleitos: ${elTxt(p.eleitos)}` : ""}{totSeg ? `; no 2º turno: ${elTxt(p.segundo)}` : ""}.{semCand}{quem.length ? <> {p.cargo === 5 ? "Eleitos" : totEl ? "Venceu" : "Foram ao 2º turno"}: {quem.join("; ")}.</> : null}</>);
  };
  linhaPlacar(dep, L("Câmara (dep. federal)", "House (federal deputy)"));
  linhaPlacar(est, L("Assembleia (dep. estadual)", "State assembly"));
  linhaPlacar(sen, L("Senado", "Senate"));
  linhaPlacar(gov, L("Governo", "Governor"));
  linhaPlacar(pres, L("Presidente (no estado)", "President (in the state)"));
  const grandesEsq = [...cidades].sort((a, b) => b.val - a.val).filter((c) => c.margem > 0).slice(0, 3).map((c) => titulo(c.nome));
  leitura.push(en()
    ? <><b>The map ({CARGOS[cargoMapa]}):</b> the far right beat the left in {fmt(vitorias.extrema)} of {fmt(cidades.length)} cities; the left won {fmt(vitorias.esquerda)}{grandesEsq.length ? <>, the largest being {grandesEsq.join(", ")}</> : null}. The centrão had more votes than both in {fmt(centraoLidera)}.</>
    : <><b>O mapa ({CARGOS[cargoMapa]}):</b> a extrema direita superou a esquerda em {fmt(vitorias.extrema)} de {fmt(cidades.length)} cidades; a esquerda venceu em {fmt(vitorias.esquerda)}{grandesEsq.length ? <>, as maiores delas {grandesEsq.join(", ")}</> : null}. O centrão teve mais votos que os dois em {fmt(centraoLidera)}.</>);
  const blocosDinheiro = (["extrema", "centrao", "esquerda"] as Bloco[]).filter((b) => trafego[b].eleitos);
  if (blocosDinheiro.some((b) => trafego[b].comAnuncio)) {
    const nm = (b: Bloco) => NOME_BLOCO(b).toLowerCase();
    const gasto = blocosDinheiro.map((b) => {
      const t = trafego[b], g = t.comAnuncio ? fmtFaixa(t.gmin, t.gmax, "R$ ") : "R$ 0";
      return en() ? `${nm(b)} ${g} across ${fmt(t.anuncios)} ads (${t.comAnuncio} of ${t.eleitos} elected advertised)`
        : `${nm(b)} ${g} em ${fmt(t.anuncios)} anúncios (${t.comAnuncio} de ${t.eleitos} eleitos anunciaram)`;
    }).join("; ");
    const lista = (f: (b: Bloco) => string) => blocosDinheiro.map((b) => `${nm(b)} ${f(b)}`).join(", ");
    leitura.push(en()
      ? <><b>The money (elected, Meta ads):</b> {gasto}. Cost per 1,000 reached: {lista((b) => fmtRS(custo(trafego[b])))}. Spend per vote of those who advertised: {lista((b) => fmtRS(porVoto(trafego[b])))}.</>
      : <><b>O dinheiro (eleitos, anúncios na Meta):</b> {gasto}. Custo por mil alcançados: {lista((b) => fmtRS(custo(trafego[b])))}. Gasto por voto de quem anunciou: {lista((b) => fmtRS(porVoto(trafego[b])))}.</>);
  }
  const topTema = (b: Bloco) => {
    const t = temasBloco[b];
    if (!t.total) return null;
    const top = [...t.por.entries()].filter(([k]) => EIXOS[0].temas.some((x) => x.id === k)).sort((a, b2) => b2[1] - a[1]).slice(0, 3);
    return top.length ? top.map(([id, n]) => `${rotuloDe(EIXOS[0].temas.find((x) => x.id === id)!)} (${pct(n / t.total, 0)})`).join(", ") : null;
  };
  if (topTema("esquerda") || topTema("extrema") || topTema("centrao")) leitura.push(en()
    ? <><b>The message:</b> top policy themes of the far right: {topTema("extrema") ?? "no ads"}; of the centrão: {topTema("centrao") ?? "no ads"}; of the left: {topTema("esquerda") ?? "no ads"} (share of each bloc's distinct creatives).</>
    : <><b>A mensagem:</b> temas de política mais frequentes da extrema direita: {topTema("extrema") ?? "sem anúncios"}; do centrão: {topTema("centrao") ?? "sem anúncios"}; da esquerda: {topTema("esquerda") ?? "sem anúncios"} (parcela dos criativos distintos de cada bloco).</>);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="eyebrow">{L(`Esquerda × centrão × extrema direita · ${info.nome} · 1º turno 2026`, `Left × centrão × far right · ${info.nome} · 1st round 2026`)}</div>
        <h1 className="display text-4xl md:text-5xl">{L("Apocalipse", "Apocalypse")}</h1>
      </header>

      <section aria-label={L("Leitura apocalíptica", "Apocalyptic reading")} className="rounded-lg border-2 border-danger/60 bg-panel p-4">
        <h2 className="eyebrow mb-2 text-danger">{L("Leitura apocalíptica", "Apocalyptic reading")}</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">{leitura.map((x, i) => <li key={i}>{x}</li>)}</ul>
        <p className="mt-2 text-xs text-muted">
          {L("Números do TSE (1º turno) e da Biblioteca de Anúncios da Meta (só candidaturas eleitas foram coletadas). Blocos conforme a classificação abaixo, que pode ser ajustada. Cruzamentos descritivos.",
            "TSE figures (1st round) and Meta Ad Library (only elected candidacies were collected). Blocs follow the classification below, which can be adjusted. Descriptive cross-tabulations.")}
        </p>
      </section>

      <Blocos base={base} blocos={blocos} setBlocos={setBlocos} />

      <section aria-label={L("Placar", "Scoreboard")} className="flex flex-col gap-2">
        <h2 className="display text-2xl">{L("Placar", "Scoreboard")}</h2>
        <TituloTabela>{L("Votos e eleitos por bloco, por cargo", "Votes and elected by bloc, by office")}</TituloTabela>
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted">
              <th className="px-3 py-2">{L("Cargo", "Office")}</th>
              <th className="px-3 py-2 text-right">{NOME_BLOCO("esquerda")}</th><th className="px-3 py-2 text-right">{NOME_BLOCO("centrao")}</th>
              <th className="px-3 py-2 text-right">{NOME_BLOCO("extrema")}</th>
              <th className="px-3 py-2 text-right">{NOME_BLOCO("demais")}</th><th className="px-3 py-2">{L("Proporção dos válidos", "Share of valid votes")}</th>
              <th className="px-3 py-2 text-right">{L("Eleitos: esquerda × centrão × extrema direita", "Elected: left × centrão × far right")}</th>
            </tr></thead>
            <tbody>{placar.map((p) => {
              const s = (b: Bloco) => p.votos[b] / p.validos;
              return (
                <tr key={p.cargo} className="border-t border-line">
                  <td className="px-3 py-2 font-semibold">{CARGOS[p.cargo]}{p.cargo === 5 && <div className="text-xs font-normal text-muted">{L("2 votos por eleitor", "2 votes per voter")}</div>}</td>
                  <td className="num px-3 text-right">{pct(s("esquerda"), 1)}<div className="text-xs text-muted">{fmt(p.votos.esquerda)}</div></td>
                  <td className="num px-3 text-right">{pct(s("centrao"), 1)}<div className="text-xs text-muted">{fmt(p.votos.centrao)}</div></td>
                  <td className="num px-3 text-right">{pct(s("extrema"), 1)}<div className="text-xs text-muted">{fmt(p.votos.extrema)}</div></td>
                  <td className="num px-3 text-right">{pct(s("demais"), 1)}</td>
                  <td className="px-3"><div className="flex h-3 w-48 overflow-hidden rounded-sm" aria-hidden>
                    {(["esquerda", "centrao", "demais", "extrema"] as Bloco[]).map((b) => <span key={b} title={NOME_BLOCO(b)} style={{ width: `${(p.votos[b] / BLOCOS.reduce((a, k) => a + p.votos[k], 0)) * 100}%`, background: cssRgb(cor[b]) }} />)}
                  </div></td>
                  <td className="num px-3 text-right">{p.eleitos.esquerda} × {p.eleitos.centrao} × {p.eleitos.extrema}{p.segundo.esquerda + p.segundo.centrao + p.segundo.extrema ? <div className="text-xs text-muted">{L("2º turno", "runoff")}: {p.segundo.esquerda} × {p.segundo.centrao} × {p.segundo.extrema}</div> : null}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>

      <section aria-label={L("Território", "Territory")} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="display text-2xl">{L("Território", "Territory")}</h2>
          <Segmented label={L("Cargo do mapa", "Map office")} value={String(cargoMapa)} onChange={(v) => setCargoMapa(Number(v))}
            options={placar.map((p) => ({ id: String(p.cargo), label: CARGOS[p.cargo] }))} />
        </div>
        <LazyMap base={base} dados={vazio} municipio={null} modo="municipios" metrica="pct" corPorMunicipio={corPorMunicipio} infoExtra={infoExtra}
          rotuloSerie={L("votos", "votes")} altura="min(62vh, 620px)" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label={L("Legenda", "Legend")}>
          {[
            [cor.div[0], L("extrema direita +20 p.p. ou mais", "far right +20 pp or more")], [cor.div[1], L("extrema direita +5 a 20", "far right +5 to 20")],
            [cor.div[2], L("equilíbrio (±5 p.p.)", "even (±5 pp)")], [cor.div[3], L("esquerda +5 a 20", "left +5 to 20")], [cor.div[4], L("esquerda +20 p.p. ou mais", "left +20 pp or more")],
          ].map(([c, t]) => <span key={t as string} className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm" style={{ background: cssRgb(c as RGB) }} />{t as string}</span>)}
        </div>
        <Cidades cidades={cidades} cargo={cargoMapa} />
      </section>

      <section aria-label={L("Tráfego pago", "Paid ads")} className="flex flex-col gap-2">
        <h2 className="display text-2xl">{L("Tráfego pago dos eleitos", "Paid ads of the elected")}</h2>
        <TituloTabela>{L("Anúncios na Meta das candidaturas eleitas (governo, Senado, Câmara e Assembleia), por bloco", "Meta ads of elected candidacies (governor, Senate, House, assembly), by bloc")}</TituloTabela>
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted">
              <th className="px-3 py-2">{L("Bloco", "Bloc")}</th><th className="px-3 py-2 text-right">{L("Eleitos", "Elected")}</th>
              <th className="px-3 py-2 text-right">{L("Com anúncios", "With ads")}</th><th className="px-3 py-2 text-right">{L("Anúncios", "Ads")}</th>
              <th className="px-3 py-2 text-right">{L("Gasto declarado", "Declared spend")}</th><th className="px-3 py-2 text-right">{L("Custo por mil alcançados", "Cost per 1,000 reached")}</th>
              <th className="px-3 py-2 text-right">{L("Gasto por voto*", "Spend per vote*")}</th>
            </tr></thead>
            <tbody>{BLOCOS.map((b) => {
              const t = trafego[b];
              return (
                <tr key={b} className="border-t border-line">
                  <td className="px-3 py-2 font-semibold"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: cssRgb(cor[b]) }} />{NOME_BLOCO(b)}</td>
                  <td className="num px-3 text-right">{t.eleitos}</td><td className="num px-3 text-right">{t.comAnuncio}</td>
                  <td className="num px-3 text-right">{fmt(t.anuncios)}</td>
                  <td className="num whitespace-nowrap px-3 text-right">{t.comAnuncio ? fmtFaixa(t.gmin, t.gmax, "R$ ") : "–"}</td>
                  <td className="num whitespace-nowrap px-3 text-right">{fmtRS(custo(t))}</td>
                  <td className="num whitespace-nowrap px-3 text-right">{fmtRS(porVoto(t))}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          {L("* Gasto declarado das candidaturas eleitas que anunciaram ÷ votos dessas candidaturas (faixa). Não mede efeito: quem anuncia mais costuma já ser mais forte. Só candidaturas eleitas foram coletadas na Biblioteca de Anúncios.",
            "* Declared spend of elected candidacies that advertised ÷ those candidacies' votes (range). It does not measure effect: those who advertise more are usually already stronger. Only elected candidacies were collected from the Ad Library.")}
        </p>
        <TemasBlocos temasBloco={temasBloco} cor={cor} />
      </section>

      <MaisVotados base={base} blocos={blocos} resumo={resumo} />
    </div>
  );
}

function Blocos({ base, blocos, setBlocos }: { base: Base; blocos: Record<string, Bloco>; setBlocos: (b: Record<string, Bloco>) => void }) {
  const partidos = useMemo(() => {
    const v = new Map<string, number>();
    for (const c of base.candidaturas) if (c.partido) v.set(c.partido.toUpperCase(), (v.get(c.partido.toUpperCase()) ?? 0) + c.votos);
    return [...v.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [base]);
  const prox: Record<Bloco, Bloco> = { esquerda: "centrao", centrao: "extrema", extrema: "demais", demais: "esquerda" };
  const cor = COR();
  return (
    <details className="rounded-lg border border-line bg-panel p-3 text-sm">
      <summary className="cursor-pointer font-semibold">{L("Classificação dos partidos (clique num partido para mudar de bloco)", "Party classification (click a party to change its bloc)")}</summary>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {partidos.map((p) => {
          const b = blocoDe(blocos, p);
          return (
            <button key={p} type="button" onClick={() => setBlocos({ ...blocos, [p]: prox[b] })} title={NOME_BLOCO(b)}
              className="rounded border border-line px-2 py-0.5 text-xs" style={{ background: b === "demais" ? undefined : cssRgb(cor[b]), color: b === "demais" ? undefined : "white" }}>
              {p} · {NOME_BLOCO(b)}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">
        {L("Padrão: esquerda = PT, PSOL, PCdoB, PV, REDE, PSB, PDT, UP, PCB, PSTU, PCO; centrão = PP, Republicanos, União, MDB, PSD, Podemos, PRD, Solidariedade, Avante, Agir, Mobiliza; extrema direita = PL, NOVO, MISSÃO, DC; demais = PSDB, Cidadania, Democrata e outros. A escolha fica salva neste navegador.",
          "Default: left = PT, PSOL, PCdoB, PV, REDE, PSB, PDT, UP, PCB, PSTU, PCO; centrão = PP, Republicanos, União, MDB, PSD, Podemos, PRD, Solidariedade, Avante, Agir, Mobiliza; far right = PL, NOVO, MISSÃO, DC; others = PSDB, Cidadania, Democrata and the rest. Your choice is saved in this browser.")}
        {" "}<button type="button" className="text-accent" onClick={() => setBlocos({ ...PADRAO })}>{L("Voltar ao padrão", "Reset to default")}</button>
      </p>
      <p className="mt-2 text-xs text-muted">
        {L("Centrão: a lista segue o survey com 379 cientistas políticos da ABCP (", "Centrão (Brazil's transactional, office-seeking parties): the list follows the ABCP survey of 379 political scientists (")}
        <a className="text-accent" href="https://congressoemfoco.com.br/coluna/37360/afinal-que-partidos-integram-o-centrao-pesquisa-inedita-aponta" target="_blank" rel="noreferrer">Testa, Mesquita &amp; Bolognesi, Cadernos CRH, 2024</a>
        {L("), que aponta PP, Republicanos, PL, PTB, Patriota, MDB, União Brasil, Podemos e PSD. PTB e Patriota hoje são o PRD; Solidariedade, Avante, Agir e Mobiliza entram pelo mesmo perfil fisiológico. O survey inclui o PL no centrão; aqui ele fica na extrema direita, pelo alinhamento bolsonarista (",
          "), which lists PP, Republicanos, PL, PTB, Patriota, MDB, União Brasil, Podemos and PSD. PTB and Patriota are now PRD; Solidariedade, Avante, Agir and Mobiliza join for the same office-seeking profile. The survey includes PL in the centrão; here it stays in the far right because of its Bolsonarist alignment (")}
        <a className="text-accent" href="https://scielo.br/j/dados/a/zzyM3gzHD4P45WWdytXjZWg/?format=pdf" target="_blank" rel="noreferrer">Bolognesi, Ribeiro &amp; Codato, Dados, 2023</a>
        {L("). PSDB e Cidadania ficam em Demais (centro-direita programática).", "). PSDB and Cidadania stay in Others (programmatic centre-right).")}
      </p>
    </details>
  );
}

interface LinhaCid { cd: string; nome: string; val: number; esq: number; cen: number; ext: number; margem: number }

function Cidades({ cidades, cargo }: { cidades: LinhaCid[]; cargo: number }) {
  const columns = useMemo<ColumnDef<LinhaCid, unknown>[]>(() => [
    { id: "nome", accessorKey: "nome", header: L("Cidade", "City"), cell: (x) => <span className="font-semibold">{titulo(x.row.original.nome)}</span> },
    { id: "val", accessorKey: "val", header: L("Votos válidos", "Valid votes"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "esq", accessorKey: "esq", header: L("Esquerda", "Left"), cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "cen", accessorKey: "cen", header: L("Centrão", "Centrão"), cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "ext", accessorKey: "ext", header: L("Extrema direita", "Far right"), cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "margem", accessorKey: "margem", header: L("Margem (esq. − ext.)", "Margin (left − far right)"), cell: (x) => {
      const v = Number(x.getValue()) * 100;
      return <span className={v >= 0 ? "text-accent" : "text-danger"}>{v > 0 ? "+" : ""}{dec(v, 1)} {L("p.p.", "pp")}</span>;
    }, meta: { numeric: true } },
  ], []);
  const exportCols: ExportCol<LinhaCid>[] = [
    { header: L("Cidade", "City"), value: (l) => l.nome }, { header: L("Código TSE", "TSE code"), value: (l) => l.cd },
    { header: L("Votos válidos", "Valid votes"), value: (l) => l.val, type: "number" },
    { header: L("Esquerda (% válidos)", "Left (% valid)"), value: (l) => l.esq, type: "percent" },
    { header: L("Centrão (% válidos)", "Centrão (% valid)"), value: (l) => l.cen, type: "percent" },
    { header: L("Extrema direita (% válidos)", "Far right (% valid)"), value: (l) => l.ext, type: "percent" },
    { header: L("Margem (esquerda − extrema direita)", "Margin (left − far right)"), value: (l) => l.margem, type: "percent" },
  ];
  return (
    <DataTable titulo={L(`Esquerda × centrão × extrema direita por cidade — ${CARGOS[cargo]}`, `Left × centrão × far right by city — ${CARGOS[cargo]}`)}
      data={cidades} columns={columns} exportCols={exportCols} nomeArquivo={`apocalipse_cidades_${cargo}`} busca={(l) => l.nome}
      initialSort={[{ id: "val", desc: true }]} pageSize={15}
      atalhos={[
        { label: L("Maiores cidades", "Largest cities"), sort: [{ id: "val", desc: true }] },
        { label: L("Mais à esquerda", "Most left"), sort: [{ id: "margem", desc: true }] },
        { label: L("Mais à extrema direita", "Most far right"), sort: [{ id: "margem", desc: false }] },
        { label: L("Mais centrão", "Most centrão"), sort: [{ id: "cen", desc: true }] },
      ]} />
  );
}

function TemasBlocos({ temasBloco, cor }: { temasBloco: Record<Bloco, { total: number; por: Map<string, number> }>; cor: ReturnType<typeof COR> }) {
  const lados: Bloco[] = ["esquerda", "centrao", "extrema"];
  const sh = (b: Bloco, id: string) => (temasBloco[b].total ? (temasBloco[b].por.get(id) ?? 0) / temasBloco[b].total : 0);
  const temas = EIXOS[0].temas.map((t) => ({ t, v: lados.map((b) => sh(b, t.id)) }))
    .filter((r) => r.v.some(Boolean)).sort((a, b) => Math.max(...b.v) - Math.max(...a.v)).slice(0, 12);
  if (!temas.length) return null;
  const max = Math.max(...temas.flatMap((r) => r.v), 0.0001);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
      <TituloTabela>{L("O que cada bloco fala: temas de política nos criativos dos eleitos (% dos criativos distintos do bloco)", "What each bloc talks about: policy themes in the elected's creatives (% of the bloc's distinct creatives)")}</TituloTabela>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] grid-cols-[minmax(0,170px)_1fr_1fr_1fr] items-center gap-x-3 gap-y-1 text-sm">
          <span />
          {lados.map((b) => <span key={b} className="text-xs font-semibold text-muted">{NOME_BLOCO(b)}{!temasBloco[b].total && <span className="font-normal"> · {L("sem anúncios", "no ads")}</span>}</span>)}
          {temas.map(({ t, v }) => (
            <div key={t.id} className="contents">
              <span className="truncate">{rotuloDe(t)}</span>
              {lados.map((b, k) => (
                <span key={b} className="flex items-center gap-1.5">
                  <span className="h-2.5 rounded-sm" style={{ width: `${(v[k] / max) * 80}%`, background: cssRgb(cor[b]) }} />
                  <span className="num text-xs">{pct(v[k], 0)}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">{L("Classificação por termos (a mesma do card de temas). Um criativo pode ter mais de um tema.", "Keyword classification (same as the themes card). A creative can have more than one theme.")}</p>
    </div>
  );
}

function MaisVotados({ base, blocos, resumo }: { base: Base; blocos: Record<string, Bloco>; resumo?: MetaResumo }) {
  const porId = new Map((resumo?.candidaturas ?? []).map((c) => [c.candidatura_id, c]));
  const lista = (cargo: number, b: Bloco) => base.candidaturas.filter((c) => c.cargo === cargo && c.tipo === "nominal" && blocoDe(blocos, c.partido) === b)
    .sort((a, b2) => b2.votos - a.votos).slice(0, 5);
  const linha = (c: Candidatura) => {
    const r = porId.get(c.id);
    return (
      <li key={c.id} className="flex items-baseline justify-between gap-2 border-b border-line py-1 last:border-0">
        <span>{nomeCand(c)} <span className="text-xs text-muted">{c.partido}</span><SituacaoBadge c={c} compacto /></span>
        <span className="num whitespace-nowrap text-right text-xs">{fmt(c.votos)} {L("votos", "votes")}{r?.anuncios ? <> · {fmtFaixa(r.gasto_min, r.gasto_aberto ? null : r.gasto_max, "R$ ")}</> : <span className="text-muted"> · {c.situacao?.startsWith("Eleito") ? L("sem anúncios identificados", "no ads identified") : L("não coletado (não eleito)", "not collected (not elected)")}</span>}</span>
      </li>
    );
  };
  return (
    <section aria-label={L("Mais votados", "Top vote-getters")} className="flex flex-col gap-2">
      <h2 className="display text-2xl">{L("Os mais votados de cada bloco", "Top vote-getters in each bloc")}</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {[6, 7].map((cargo) => (["esquerda", "centrao", "extrema"] as Bloco[]).map((b) => (
          <div key={`${cargo}-${b}`} className="rounded-lg border border-line bg-panel p-3">
            <TituloTabela>{L(`${CARGOS[cargo]}: 5 mais votados — ${NOME_BLOCO(b)} (votos e gasto em anúncios)`, `${CARGOS[cargo]}: top 5 — ${NOME_BLOCO(b)} (votes and ad spend)`)}</TituloTabela>
            <ul className="mt-1 text-sm">{lista(cargo, b).map(linha)}</ul>
          </div>
        )))}
      </div>
    </section>
  );
}
