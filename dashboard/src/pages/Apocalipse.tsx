import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { DataTable, TituloTabela } from "../components/DataTable";
import { LazyMap } from "../components/LazyMap";
import { ErrorBox, Loading, Segmented, SituacaoBadge, nomeCand } from "../components/ui";
import { PADRAO, blocoDe, lerBlocos, salvarBlocos, type Bloco } from "../lib/blocos";
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
 * Apocalipse: esquerda × extrema direita no estado. Votos e eleitos (TSE), território (margem por cidade), tráfego pago
 * dos eleitos (Biblioteca de Anúncios da Meta: só candidaturas eleitas foram coletadas) e temas dos criativos.
 * Tom direto, números exatos; cruzamentos descritivos.
 */

const CARGOS_APOC = [1, 3, 5, 6, 7];
const en = () => getLang() === "en";
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// esquerda = roxo (identidade do painel); extrema direita = laranja; validados para daltonismo (mesma paleta do Senado)
const COR = () => (prefersDark()
  ? { esquerda: hex("#a466d0"), extrema: hex("#c47c22"), demais: hex("#5c5463"), div: ["#c47c22", "#7a5a3a", "#3a343f", "#7a4f9a", "#b37ad9"].map(hex) }
  : { esquerda: hex("#7b1fa2"), extrema: hex("#c86a00"), demais: hex("#b9b3bd"), div: ["#c86a00", "#eab27a", "#e6e2e8", "#b98ad6", "#6a2399"].map(hex) });
const NOME_BLOCO = (b: Bloco) => (b === "esquerda" ? L("Esquerda", "Left") : b === "extrema" ? L("Extrema direita", "Far right") : L("Demais", "Others"));

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
    const votos: Record<Bloco, number> = { esquerda: 0, extrema: 0, demais: 0 };
    apoc.votos.cargo.forEach((c, i) => { if (c === cargo) votos[blocoDe(blocos, apoc.votos.partido[i])] += apoc.votos.votos[i]; });
    let validos = 0;
    apoc.validos.cargo.forEach((c, i) => { if (c === cargo) validos += apoc.validos.validos[i]; });
    const eleitos: Record<Bloco, number> = { esquerda: 0, extrema: 0, demais: 0 };
    const segundo: Record<Bloco, number> = { esquerda: 0, extrema: 0, demais: 0 };
    for (const c of base.candidaturas) {
      if (c.cargo !== cargo || c.tipo !== "nominal") continue;
      if (c.situacao?.startsWith("Eleito")) eleitos[blocoDe(blocos, c.partido)]++;
      if (c.situacao === "2º turno") segundo[blocoDe(blocos, c.partido)]++;
    }
    return { cargo, validos, votos, eleitos, segundo };
  }).filter((p) => p.validos > 0), [apoc, base, blocos]);

  // ---- território: margem por cidade no cargo escolhido ----
  const porMun = useMemo(() => {
    const m = new Map<string, { esq: number; ext: number; dem: number; val: number }>();
    apoc.votos.cargo.forEach((c, i) => {
      if (c !== cargoMapa) return;
      const k = apoc.votos.mun[i];
      const x = m.get(k) ?? { esq: 0, ext: 0, dem: 0, val: 0 };
      const b = blocoDe(blocos, apoc.votos.partido[i]);
      if (b === "esquerda") x.esq += apoc.votos.votos[i]; else if (b === "extrema") x.ext += apoc.votos.votos[i]; else x.dem += apoc.votos.votos[i];
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
    return `${NOME_BLOCO("esquerda")}: ${pct(x.esq / x.val, 1)} · ${NOME_BLOCO("extrema")}: ${pct(x.ext / x.val, 1)}`;
  }, [porMun]);
  const vazio = useMemo<PorLocal>(() => ({ votos: new Float64Array(base.locais.length), validos: new Float64Array(base.locais.length), total: 0, totalValidos: 0 }), [base]);

  const cidades = useMemo(() => [...porMun.entries()].filter(([, x]) => x.val > 0).map(([cd, x]) => ({
    cd, nome: base.munByCd.get(cd)?.nome ?? cd, val: x.val, esq: x.esq / x.val, ext: x.ext / x.val, margem: (x.esq - x.ext) / x.val,
  })), [porMun, base]);
  const vitorias = { esquerda: cidades.filter((c) => c.margem > 0).length, extrema: cidades.filter((c) => c.margem < 0).length };

  // ---- tráfego pago dos eleitos ----
  const trafego = useMemo(() => {
    const porId = new Map((resumo?.candidaturas ?? []).map((c) => [c.candidatura_id, c]));
    const tot = {} as Record<Bloco, { eleitos: number; comAnuncio: number; anuncios: number; gmin: number; gmax: number | null; cgmin: number; cgmax: number | null; alc: number; votos: number; votosComAnuncio: number }>;
    for (const b of ["esquerda", "extrema", "demais"] as Bloco[]) tot[b] = { eleitos: 0, comAnuncio: 0, anuncios: 0, gmin: 0, gmax: 0, cgmin: 0, cgmax: 0, alc: 0, votos: 0, votosComAnuncio: 0 };
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
    for (const b of ["esquerda", "extrema", "demais"] as Bloco[]) out[b] = { total: 0, por: new Map() };
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
    const e = p.votos.esquerda / p.validos, x = p.votos.extrema / p.validos, d = (x - e) * 100;
    const majoritario = [1, 3, 5].includes(p.cargo);
    const quem = majoritario ? vencedores(p.cargo) : [];
    const ausente = !p.votos.extrema ? "extrema" : !p.votos.esquerda ? "esquerda" : null;
    if (ausente) {
      leitura.push(en()
        ? <><b>{rot}:</b> the {NOME_BLOCO(ausente).toLowerCase()} had no candidacy (by the current classification); {NOME_BLOCO(ausente === "extrema" ? "esquerda" : "extrema").toLowerCase()} {pct(ausente === "extrema" ? e : x, 1)} of valid votes.{quem.length ? <> Winner: {quem.join("; ")}.</> : null}</>
        : <><b>{rot}:</b> a {NOME_BLOCO(ausente).toLowerCase()} não teve candidatura (pela classificação atual); {NOME_BLOCO(ausente === "extrema" ? "esquerda" : "extrema").toLowerCase()} {pct(ausente === "extrema" ? e : x, 1)} dos válidos.{quem.length ? <> Venceu: {quem.join("; ")}.</> : null}</>);
      return;
    }
    leitura.push(en()
      ? <><b>{rot}:</b> far right {pct(x, 1)} of valid votes, left {pct(e, 1)} ({d >= 0 ? `${dec(d, 1)} pp ahead for the far right` : `${dec(-d, 1)} pp ahead for the left`}); elected: far right {p.eleitos.extrema}, left {p.eleitos.esquerda}{p.segundo.esquerda + p.segundo.extrema ? `; runoff: far right ${p.segundo.extrema}, left ${p.segundo.esquerda}` : ""}.{quem.length ? <> {p.cargo === 5 ? "Elected" : p.eleitos.esquerda + p.eleitos.extrema + p.eleitos.demais ? "Winner" : "In the runoff"}: {quem.join("; ")}.</> : null}</>
      : <><b>{rot}:</b> extrema direita {pct(x, 1)} dos válidos, esquerda {pct(e, 1)} ({d >= 0 ? `${dec(d, 1)} p.p. de vantagem para a extrema direita` : `${dec(-d, 1)} p.p. de vantagem para a esquerda`}); eleitos: extrema direita {p.eleitos.extrema}, esquerda {p.eleitos.esquerda}{p.segundo.esquerda + p.segundo.extrema ? `; no 2º turno: extrema direita ${p.segundo.extrema}, esquerda ${p.segundo.esquerda}` : ""}.{quem.length ? <> {p.cargo === 5 ? "Eleitos" : p.eleitos.esquerda + p.eleitos.extrema + p.eleitos.demais ? "Venceu" : "Foram ao 2º turno"}: {quem.join("; ")}.</> : null}</>);
  };
  linhaPlacar(dep, L("Câmara (dep. federal)", "House (federal deputy)"));
  linhaPlacar(est, L("Assembleia (dep. estadual)", "State assembly"));
  linhaPlacar(sen, L("Senado", "Senate"));
  linhaPlacar(gov, L("Governo", "Governor"));
  linhaPlacar(pres, L("Presidente (no estado)", "President (in the state)"));
  const grandesEsq = [...cidades].sort((a, b) => b.val - a.val).filter((c) => c.margem > 0).slice(0, 3).map((c) => titulo(c.nome));
  leitura.push(en()
    ? <><b>The map ({CARGOS[cargoMapa]}):</b> the far right beat the left in {fmt(vitorias.extrema)} of {fmt(cidades.length)} cities; the left won {fmt(vitorias.esquerda)}{grandesEsq.length ? <>, the largest being {grandesEsq.join(", ")}</> : null}.</>
    : <><b>O mapa ({CARGOS[cargoMapa]}):</b> a extrema direita superou a esquerda em {fmt(vitorias.extrema)} de {fmt(cidades.length)} cidades; a esquerda venceu em {fmt(vitorias.esquerda)}{grandesEsq.length ? <>, as maiores delas {grandesEsq.join(", ")}</> : null}.</>);
  const te = trafego.esquerda, tx = trafego.extrema;
  if (te.comAnuncio || tx.comAnuncio) leitura.push(en()
    ? <><b>The money (elected, Meta ads):</b> far right {fmtFaixa(tx.gmin, tx.gmax, "R$ ")} across {fmt(tx.anuncios)} ads ({tx.comAnuncio} of {tx.eleitos} elected advertised), left {fmtFaixa(te.gmin, te.gmax, "R$ ")} across {fmt(te.anuncios)} ads ({te.comAnuncio} of {te.eleitos}). Cost per 1,000 reached: far right {fmtRS(custo(tx))}, left {fmtRS(custo(te))}. Spend per vote of those who advertised: far right {fmtRS(porVoto(tx))}, left {fmtRS(porVoto(te))}.</>
    : <><b>O dinheiro (eleitos, anúncios na Meta):</b> extrema direita {fmtFaixa(tx.gmin, tx.gmax, "R$ ")} em {fmt(tx.anuncios)} anúncios ({tx.comAnuncio} de {tx.eleitos} eleitos anunciaram), esquerda {fmtFaixa(te.gmin, te.gmax, "R$ ")} em {fmt(te.anuncios)} anúncios ({te.comAnuncio} de {te.eleitos}). Custo por mil alcançados: extrema direita {fmtRS(custo(tx))}, esquerda {fmtRS(custo(te))}. Gasto por voto de quem anunciou: extrema direita {fmtRS(porVoto(tx))}, esquerda {fmtRS(porVoto(te))}.</>);
  const topTema = (b: Bloco) => {
    const t = temasBloco[b];
    if (!t.total) return null;
    const top = [...t.por.entries()].filter(([k]) => EIXOS[0].temas.some((x) => x.id === k)).sort((a, b2) => b2[1] - a[1]).slice(0, 3);
    return top.length ? top.map(([id, n]) => `${rotuloDe(EIXOS[0].temas.find((x) => x.id === id)!)} (${pct(n / t.total, 0)})`).join(", ") : null;
  };
  if (topTema("esquerda") || topTema("extrema")) leitura.push(en()
    ? <><b>The message:</b> the far right's top policy themes: {topTema("extrema") ?? "–"}; the left's: {topTema("esquerda") ?? "–"} (share of each bloc's distinct creatives).</>
    : <><b>A mensagem:</b> temas de política mais frequentes da extrema direita: {topTema("extrema") ?? "–"}; da esquerda: {topTema("esquerda") ?? "–"} (parcela dos criativos distintos de cada bloco).</>);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="eyebrow">{L(`Esquerda × extrema direita · ${info.nome} · 1º turno 2026`, `Left × far right · ${info.nome} · 1st round 2026`)}</div>
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
              <th className="px-3 py-2 text-right">{NOME_BLOCO("esquerda")}</th><th className="px-3 py-2 text-right">{NOME_BLOCO("extrema")}</th>
              <th className="px-3 py-2 text-right">{NOME_BLOCO("demais")}</th><th className="px-3 py-2">{L("Proporção dos válidos", "Share of valid votes")}</th>
              <th className="px-3 py-2 text-right">{L("Eleitos: esquerda × extrema direita", "Elected: left × far right")}</th>
            </tr></thead>
            <tbody>{placar.map((p) => {
              const s = (b: Bloco) => p.votos[b] / p.validos;
              return (
                <tr key={p.cargo} className="border-t border-line">
                  <td className="px-3 py-2 font-semibold">{CARGOS[p.cargo]}{p.cargo === 5 && <div className="text-xs font-normal text-muted">{L("2 votos por eleitor", "2 votes per voter")}</div>}</td>
                  <td className="num px-3 text-right">{pct(s("esquerda"), 1)}<div className="text-xs text-muted">{fmt(p.votos.esquerda)}</div></td>
                  <td className="num px-3 text-right">{pct(s("extrema"), 1)}<div className="text-xs text-muted">{fmt(p.votos.extrema)}</div></td>
                  <td className="num px-3 text-right">{pct(s("demais"), 1)}</td>
                  <td className="px-3"><div className="flex h-3 w-48 overflow-hidden rounded-sm" aria-hidden>
                    {(["esquerda", "demais", "extrema"] as Bloco[]).map((b) => <span key={b} style={{ width: `${(p.votos[b] / (p.votos.esquerda + p.votos.extrema + p.votos.demais)) * 100}%`, background: cssRgb(cor[b]) }} />)}
                  </div></td>
                  <td className="num px-3 text-right">{p.eleitos.esquerda} × {p.eleitos.extrema}{p.segundo.esquerda + p.segundo.extrema ? <div className="text-xs text-muted">{L("2º turno", "runoff")}: {p.segundo.esquerda} × {p.segundo.extrema}</div> : null}</td>
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
            <tbody>{(["esquerda", "extrema", "demais"] as Bloco[]).map((b) => {
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
  const prox: Record<Bloco, Bloco> = { esquerda: "extrema", extrema: "demais", demais: "esquerda" };
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
        {L("Padrão: esquerda = PT, PSOL, PCdoB, PV, REDE, PSB, PDT, UP, PCB, PSTU, PCO; extrema direita = PL, NOVO, MISSÃO, DC. A escolha fica salva neste navegador.",
          "Default: left = PT, PSOL, PCdoB, PV, REDE, PSB, PDT, UP, PCB, PSTU, PCO; far right = PL, NOVO, MISSÃO, DC. Your choice is saved in this browser.")}
        {" "}<button type="button" className="text-accent" onClick={() => setBlocos({ ...PADRAO })}>{L("Voltar ao padrão", "Reset to default")}</button>
      </p>
    </details>
  );
}

interface LinhaCid { cd: string; nome: string; val: number; esq: number; ext: number; margem: number }

function Cidades({ cidades, cargo }: { cidades: LinhaCid[]; cargo: number }) {
  const columns = useMemo<ColumnDef<LinhaCid, unknown>[]>(() => [
    { id: "nome", accessorKey: "nome", header: L("Cidade", "City"), cell: (x) => <span className="font-semibold">{titulo(x.row.original.nome)}</span> },
    { id: "val", accessorKey: "val", header: L("Votos válidos", "Valid votes"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "esq", accessorKey: "esq", header: L("Esquerda", "Left"), cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
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
    { header: L("Extrema direita (% válidos)", "Far right (% valid)"), value: (l) => l.ext, type: "percent" },
    { header: L("Margem (esquerda − extrema direita)", "Margin (left − far right)"), value: (l) => l.margem, type: "percent" },
  ];
  return (
    <DataTable titulo={L(`Esquerda × extrema direita por cidade — ${CARGOS[cargo]}`, `Left × far right by city — ${CARGOS[cargo]}`)}
      data={cidades} columns={columns} exportCols={exportCols} nomeArquivo={`apocalipse_cidades_${cargo}`} busca={(l) => l.nome}
      initialSort={[{ id: "val", desc: true }]} pageSize={15}
      atalhos={[
        { label: L("Maiores cidades", "Largest cities"), sort: [{ id: "val", desc: true }] },
        { label: L("Mais à esquerda", "Most left"), sort: [{ id: "margem", desc: true }] },
        { label: L("Mais à extrema direita", "Most far right"), sort: [{ id: "margem", desc: false }] },
      ]} />
  );
}

function TemasBlocos({ temasBloco, cor }: { temasBloco: Record<Bloco, { total: number; por: Map<string, number> }>; cor: ReturnType<typeof COR> }) {
  const temas = EIXOS[0].temas.map((t) => ({ t, e: temasBloco.esquerda.total ? (temasBloco.esquerda.por.get(t.id) ?? 0) / temasBloco.esquerda.total : 0,
    x: temasBloco.extrema.total ? (temasBloco.extrema.por.get(t.id) ?? 0) / temasBloco.extrema.total : 0 }))
    .filter((r) => r.e || r.x).sort((a, b) => Math.max(b.e, b.x) - Math.max(a.e, a.x)).slice(0, 12);
  if (!temas.length) return null;
  const max = Math.max(...temas.flatMap((r) => [r.e, r.x]), 0.0001);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
      <TituloTabela>{L("O que cada lado fala: temas de política nos criativos dos eleitos (% dos criativos distintos do bloco)", "What each side talks about: policy themes in the elected's creatives (% of the bloc's distinct creatives)")}</TituloTabela>
      <ul className="flex flex-col gap-1 text-sm">
        {temas.map(({ t, e, x }) => (
          <li key={t.id} className="grid grid-cols-[minmax(0,180px)_1fr_1fr] items-center gap-2">
            <span className="truncate">{rotuloDe(t)}</span>
            <span className="flex items-center justify-end gap-1.5"><span className="num text-xs">{pct(e, 0)}</span><span className="h-2.5 rounded-sm" style={{ width: `${(e / max) * 100}%`, background: cssRgb(cor.esquerda) }} /></span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 rounded-sm" style={{ width: `${(x / max) * 100}%`, background: cssRgb(cor.extrema) }} /><span className="num text-xs">{pct(x, 0)}</span></span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{L("Barra roxa: esquerda · barra laranja: extrema direita. Classificação por termos (a mesma do card de temas).", "Purple bar: left · orange bar: far right. Keyword classification (same as the themes card).")}</p>
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
      <h2 className="display text-2xl">{L("Os mais votados de cada lado", "Top vote-getters on each side")}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {[6, 7].map((cargo) => (["esquerda", "extrema"] as Bloco[]).map((b) => (
          <div key={`${cargo}-${b}`} className="rounded-lg border border-line bg-panel p-3">
            <TituloTabela>{L(`${CARGOS[cargo]}: 5 mais votados — ${NOME_BLOCO(b)} (votos e gasto em anúncios)`, `${CARGOS[cargo]}: top 5 — ${NOME_BLOCO(b)} (votes and ad spend)`)}</TituloTabela>
            <ul className="mt-1 text-sm">{lista(cargo, b).map(linha)}</ul>
          </div>
        )))}
      </div>
    </section>
  );
}
