import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { cssRgb, prefersDark, quantis, ramp, type RGB, classe } from "../lib/colors";
import { porLocal, useTotais, useVotos, type Base } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { fmt, pct, titulo } from "../lib/format";
import { geoUrl } from "../lib/source";
import type { Candidatura } from "../lib/types";
import { useUf } from "../lib/uf";
import { DataTable } from "./DataTable";
import { LazyMap } from "./LazyMap";
import { ErrorBox, Loading, MunicipioSelect, Segmented, SituacaoBadge, Stat } from "./ui";

/*
 * Análise completa da eleição para o Senado, do ponto de vista de uma candidatura (ex.: Manuela, RS).
 * Em 2026 são 2 vagas e cada eleitor vota em 2 nomes: "% dos válidos" soma 200% por área.
 * Estado -> uma linha por cidade; com uma cidade escolhida -> uma linha por bairro (do local de votação).
 */

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// Categórica validada (validate_palette.js): foco + 3 adversários mais votados; demais em cinza.
const CAT_LIGHT = ["#7b1fa2", "#c86a00", "#1f77b4", "#2a9d5c"].map(hex);
const CAT_DARK = ["#a466d0", "#c47c22", "#4a93cc", "#3ba673"].map(hex);
const OUTROS_LIGHT = hex("#b9b3bd"), OUTROS_DARK = hex("#5c5463");
const APAGADO_LIGHT = hex("#eeebf0"), APAGADO_DARK = hex("#2a2430");
// Divergente: adversário (laranja) <- cinza -> candidatura em foco (roxo).
const DIV_LIGHT = ["#c86a00", "#eab27a", "#e6e2e8", "#b98ad6", "#6a2399"].map(hex);
const DIV_DARK = ["#c47c22", "#7a5a3a", "#3a343f", "#7a4f9a", "#b37ad9"].map(hex);

type ModoMapa = "vencedor" | "posicao" | "pct" | "rival";
type FiltroPos = "todas" | "1" | "top" | "fora";
type FiltroRival = "todas" | "frente" | "atras";

interface Area {
  key: string;
  nome: string;
  municipio: string;
  regiao: string | null;
  v: Float64Array; // votos por senador (mesma ordem de `senadores`)
  validos: number;
  aptos: number;
  ordem: number[]; // índices de senadores, do mais ao menos votado
  pos: number; // posição da candidatura em foco (1 = primeiro)
  vFoco: number;
}

const PORTES = {
  municipio: [
    { id: "p1", label: "até 5 mil eleitores", max: 5_000 },
    { id: "p2", label: "5 a 20 mil", max: 20_000 },
    { id: "p3", label: "20 a 100 mil", max: 100_000 },
    { id: "p4", label: "mais de 100 mil", max: Infinity },
  ],
  bairro: [
    { id: "p1", label: "até 2 mil eleitores", max: 2_000 },
    { id: "p2", label: "2 a 10 mil", max: 10_000 },
    { id: "p3", label: "10 a 30 mil", max: 30_000 },
    { id: "p4", label: "mais de 30 mil", max: Infinity },
  ],
};

const sinal = (x: number) => (x > 0 ? "+" : "");
const ord = (n: number) => `${n}º`;

export function SenadoAnalise({ base, cand, municipio, setMunicipio }: {
  base: Base; cand: Candidatura; municipio: string | null; setMunicipio: (cd: string | null) => void;
}) {
  const { uf } = useUf();
  const dark = prefersDark();
  const CAT = dark ? CAT_DARK : CAT_LIGHT;
  const OUTROS = dark ? OUTROS_DARK : OUTROS_LIGHT;
  const APAGADO = dark ? APAGADO_DARK : APAGADO_LIGHT;
  const DIV = dark ? DIV_DARK : DIV_LIGHT;

  const senadores = useMemo(
    () => base.candidaturas.filter((c) => c.cargo === cand.cargo && c.tipo === "nominal").sort((a, b) => b.votos - a.votos),
    [base, cand.cargo],
  );
  const iFoco = senadores.findIndex((c) => c.id === cand.id);
  const vagas = senadores.filter((c) => c.situacao?.startsWith("Eleito")).length || 2;
  const votos = useVotos(senadores.map((c) => c.id), null);
  const totais = useTotais(cand.cargo, null);

  // regiões intermediárias do IBGE (vêm nas propriedades do contorno municipal; mesmo cache do mapa)
  const geo = useQuery({
    queryKey: ["geo", "municipios", base.municipios[0]?.cd],
    queryFn: async () => (await fetch(geoUrl.municipios())).json() as Promise<{ features: { properties: Record<string, unknown> }[] }>,
    staleTime: Infinity,
  });
  const regiaoDe = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of geo.data?.features ?? []) {
      const cd = f.properties.cd_municipio as string | null, r = f.properties.regiao_intermediaria as string | null;
      if (cd && r) m.set(cd, r);
    }
    return m;
  }, [geo.data]);
  const regioes = useMemo(() => [...new Set(regiaoDe.values())].sort((a, b) => a.localeCompare(b)), [regiaoDe]);

  // votos por local de cada senador
  const porSenador = useMemo(() => {
    if (!votos.data || !totais.data) return null;
    return senadores.map((c) => porLocal(base, votos.data[c.id], totais.data));
  }, [base, senadores, votos.data, totais.data]);
  const aptosLocal = useMemo(() => {
    const a = new Float64Array(base.locais.length);
    totais.data?.local.forEach((id, i) => { const l = base.localById.get(id); if (l) a[l.idx] += totais.data!.aptos[i]; });
    return a;
  }, [base, totais.data]);

  // estado: por cidade ou por bairro (todos os bairros do estado); com cidade escolhida: sempre por bairro
  const [nivelEstado, setNivelEstado] = useState<"municipio" | "bairro">("municipio");
  const nivel = municipio ? "bairro" : nivelEstado;
  const porBairro = nivel === "bairro";
  const { areas, areaDoLocal } = useMemo(() => {
    const areaDoLocal = new Map<number, Area>();
    if (!porSenador) return { areas: [] as Area[], areaDoLocal };
    const n = senadores.length;
    const map = new Map<string, Area>();
    for (const l of base.locais) {
      if (municipio && l.mun !== municipio) continue;
      const key = porBairro ? `${l.mun}|${l.bairro}` : l.mun;
      let a = map.get(key);
      if (!a) {
        a = { key, nome: porBairro ? l.bairro : l.munNome, municipio: l.munNome, regiao: regiaoDe.get(l.mun) ?? null,
          v: new Float64Array(n), validos: 0, aptos: 0, ordem: [], pos: 0, vFoco: 0 };
        map.set(key, a);
      }
      for (let s = 0; s < n; s++) a.v[s] += porSenador[s].votos[l.idx];
      a.validos += porSenador[0].validos[l.idx];
      a.aptos += aptosLocal[l.idx];
      areaDoLocal.set(l.idx, a);
    }
    for (const a of map.values()) {
      a.ordem = [...Array(n).keys()].sort((x, y) => a.v[y] - a.v[x] || x - y);
      a.pos = a.ordem.indexOf(iFoco) + 1;
      a.vFoco = a.v[iFoco];
    }
    return { areas: [...map.values()].filter((a) => a.validos > 0), areaDoLocal };
  }, [base, porSenador, senadores.length, municipio, porBairro, regiaoDe, aptosLocal, iFoco]);

  // ranking no escopo (estado ou cidade)
  const ranking = useMemo(() => {
    const n = senadores.length;
    const tot = new Float64Array(n), venceu = new Float64Array(n), noTop = new Float64Array(n);
    let validos = 0;
    for (const a of areas) {
      for (let s = 0; s < n; s++) tot[s] += a.v[s];
      validos += a.validos;
      venceu[a.ordem[0]] += 1;
      for (let k = 0; k < vagas; k++) noTop[a.ordem[k]] += 1;
    }
    const ordem = [...Array(n).keys()].sort((x, y) => tot[y] - tot[x]);
    return { tot, venceu, noTop, validos, ordem };
  }, [areas, senadores.length, vagas]);
  const posEscopo = ranking.ordem.indexOf(iFoco) + 1;

  // adversário padrão: quem ocupa a última vaga (ou o primeiro de fora, se a candidatura em foco está dentro)
  const rivalPadrao = ranking.ordem[posEscopo <= vagas ? vagas : vagas - 1] ?? ranking.ordem[0];
  const [rivalSel, setRivalSel] = useState<number | null>(null); // id do senador
  const iRival = rivalSel != null ? senadores.findIndex((c) => c.id === rivalSel) : rivalPadrao;
  const rival = senadores[iRival];

  // cores da categoria "vencedor": foco + 3 adversários mais votados no estado
  const corSenador = useMemo(() => {
    const m = new Map<number, RGB>([[iFoco, CAT[0]]]);
    let k = 1;
    for (let s = 0; s < senadores.length && k < CAT.length; s++) if (s !== iFoco) m.set(s, CAT[k++]);
    return m;
  }, [senadores.length, iFoco, CAT]);

  // ---- filtros ----
  const [fPos, setFPos] = useState<FiltroPos>("todas");
  const [fRival, setFRival] = useState<FiltroRival>("todas");
  const [fPorte, setFPorte] = useState<string>("");
  const [fRegiao, setFRegiao] = useState<string>("");
  const [modoMapa, setModoMapa] = useState<ModoMapa>("posicao");
  const portes = PORTES[nivel];

  const passa = useCallback((a: Area) => {
    if (fPos === "1" && a.pos !== 1) return false;
    if (fPos === "top" && a.pos > vagas) return false;
    if (fPos === "fora" && a.pos <= vagas) return false;
    if (fRival !== "todas" && iRival !== iFoco) {
      const d = a.vFoco - a.v[iRival];
      if (fRival === "frente" && d <= 0) return false;
      if (fRival === "atras" && d >= 0) return false;
    }
    if (fPorte) {
      const i = portes.findIndex((p) => p.id === fPorte);
      const min = i > 0 ? portes[i - 1].max : 0;
      if (!(a.aptos > min && a.aptos <= portes[i].max)) return false;
    }
    if (fRegiao && !municipio && a.regiao !== fRegiao) return false;
    return true;
  }, [fPos, fRival, fPorte, fRegiao, vagas, iRival, iFoco, portes, municipio]);
  const filtradas = useMemo(() => areas.filter(passa), [areas, passa]);
  const filtroAtivo = fPos !== "todas" || fRival !== "todas" || !!fPorte || (!!fRegiao && !municipio);
  const limpar = () => { setFPos("todas"); setFRival("todas"); setFPorte(""); setFRegiao(""); };

  const totalFocoEscopo = ranking.tot[iFoco] ?? 0;
  const resumoFiltro = useMemo(() => {
    let v = 0, val = 0, p1 = 0, top = 0, frente = 0;
    for (const a of filtradas) {
      v += a.vFoco; val += a.validos;
      if (a.pos === 1) p1++;
      if (a.pos <= vagas) top++;
      if (a.vFoco > a.v[iRival]) frente++;
    }
    return { v, val, p1, top, frente };
  }, [filtradas, vagas, iRival]);

  // ---- cores do mapa ----
  const breaksPct = useMemo(() => quantis(areas.map((a) => a.vFoco / a.validos)), [areas]);
  const corArea = useCallback((a: Area | undefined): RGB => {
    if (!a || !passa(a)) return APAGADO;
    if (modoMapa === "vencedor") return corSenador.get(a.ordem[0]) ?? OUTROS;
    if (modoMapa === "posicao") {
      const r = ramp();
      return a.pos === 1 ? r[6] : a.pos === 2 ? r[4] : a.pos === 3 ? r[2] : a.pos <= 5 ? r[1] : r[0];
    }
    if (modoMapa === "pct") return ramp()[Math.min(classe(a.vFoco / a.validos, breaksPct), 6)];
    // vantagem sobre o adversário, em pontos percentuais dos válidos
    const d = (a.vFoco - a.v[iRival]) / a.validos;
    return d <= -0.05 ? DIV[0] : d < -0.01 ? DIV[1] : d <= 0.01 ? DIV[2] : d < 0.05 ? DIV[3] : DIV[4];
  }, [passa, modoMapa, corSenador, OUTROS, APAGADO, breaksPct, iRival, DIV]);

  const porKey = useMemo(() => new Map(areas.map((a) => [a.key, a])), [areas]);
  const corPorMunicipio = useCallback((cd: string) => corArea(porKey.get(cd)), [corArea, porKey]);
  const corPorLocal = useCallback((idx: number) => corArea(areaDoLocal.get(idx)), [corArea, areaDoLocal]);

  const nomeS = (i: number) => titulo(senadores[i]?.nome ?? "");
  const infoExtra = useCallback(({ municipio: cd, idx }: { municipio?: string; idx?: number }) => {
    const a = cd ? porKey.get(cd) : idx != null ? areaDoLocal.get(idx) : undefined;
    if (!a) return null;
    const top = a.ordem.slice(0, 3).map((s, k) => `${k + 1}º ${nomeS(s)} ${fmt(a.v[s])}`).join("<br>");
    const lugar = a.pos <= 3 ? "" : `<br>${ord(a.pos)} ${nomeS(iFoco)} ${fmt(a.vFoco)}`;
    return `${municipio ? `Bairro ${titulo(a.nome)}<br>` : ""}${top}${lugar}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [porKey, areaDoLocal, municipio, iFoco, senadores]);

  // ---- tabela ----
  const distVaga = (a: Area) => (a.pos <= vagas ? a.vFoco - a.v[a.ordem[vagas]] : a.vFoco - a.v[a.ordem[vagas - 1]]);
  const columns = useMemo<ColumnDef<Area, unknown>[]>(() => [
    { id: "nome", accessorKey: "nome", header: porBairro ? "Bairro" : "Município",
      cell: (c) => (
        <div>
          <div className="font-semibold">{titulo(c.row.original.nome)}</div>
          {!municipio && (porBairro || c.row.original.regiao) && (
            <div className="text-xs text-muted">{porBairro ? titulo(c.row.original.municipio) : `região ${c.row.original.regiao}`}</div>
          )}
        </div>
      ) },
    { id: "pos", accessorKey: "pos", header: "Posição", cell: (c) => {
      const p = Number(c.getValue());
      return <span className={p <= vagas ? "font-bold text-accent" : ""}>{ord(p)}</span>;
    }, meta: { numeric: true } },
    { id: "v", accessorKey: "vFoco", header: `Votos ${nomeS(iFoco)}`, cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    { id: "pct", accessorFn: (a) => a.vFoco / a.validos, header: "% válidos", cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
    { id: "share", accessorFn: (a) => (totalFocoEscopo ? a.vFoco / totalFocoEscopo : 0), header: "% do total",
      cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
    { id: "p1", accessorFn: (a) => a.v[a.ordem[0]], header: "1º lugar", cell: (c) => {
      const a = c.row.original;
      return <span><span className="font-sans text-muted">{nomeS(a.ordem[0])}</span> {fmt(a.v[a.ordem[0]])}</span>;
    }, meta: { numeric: true } },
    { id: "p2", accessorFn: (a) => a.v[a.ordem[1]], header: "2º lugar", cell: (c) => {
      const a = c.row.original;
      return <span><span className="font-sans text-muted">{nomeS(a.ordem[1])}</span> {fmt(a.v[a.ordem[1]])}</span>;
    }, meta: { numeric: true } },
    { id: "vaga", accessorFn: distVaga, header: `Distância à ${vagas}ª vaga`, cell: (c) => {
      const v = Number(c.getValue());
      return <span className={v >= 0 ? "text-accent" : "text-danger"}>{sinal(v)}{fmt(v)}</span>;
    }, meta: { numeric: true } },
    ...(iRival !== iFoco ? [
      { id: "rv", accessorFn: (a: Area) => a.v[iRival], header: `Votos ${nomeS(iRival)}`, cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
      { id: "rd", accessorFn: (a: Area) => a.vFoco - a.v[iRival], header: `× ${nomeS(iRival)}`, cell: (c) => {
        const v = Number(c.getValue());
        return <span className={v >= 0 ? "text-accent" : "text-danger"}>{sinal(v)}{fmt(v)}</span>;
      }, meta: { numeric: true } },
    ] as ColumnDef<Area, unknown>[] : []),
    { id: "aptos", accessorKey: "aptos", header: "Eleitores", cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [municipio, porBairro, vagas, iFoco, iRival, totalFocoEscopo, senadores]);

  const exportCols: ExportCol<Area>[] = [
    { header: porBairro ? "Bairro" : "Município", value: (a) => a.nome },
    ...(porBairro && !municipio ? [{ header: "Município", value: (a: Area) => a.municipio }] : []),
    ...(municipio ? [] : [{ header: "Região intermediária (IBGE)", value: (a: Area) => a.regiao ?? "" }]),
    { header: "Eleitores", value: (a) => a.aptos, type: "number" },
    { header: "Votos válidos (Senado)", value: (a) => a.validos, type: "number" },
    { header: "Posição", value: (a) => a.pos, type: "number" },
    { header: `Votos ${nomeS(iFoco)}`, value: (a) => a.vFoco, type: "number" },
    { header: "% válidos", value: (a) => a.vFoco / a.validos, type: "percent" },
    { header: "% do total", value: (a) => (totalFocoEscopo ? a.vFoco / totalFocoEscopo : 0), type: "percent" },
    { header: "1º lugar", value: (a) => nomeS(a.ordem[0]) },
    { header: "Votos 1º", value: (a) => a.v[a.ordem[0]], type: "number" },
    { header: "2º lugar", value: (a) => nomeS(a.ordem[1]) },
    { header: "Votos 2º", value: (a) => a.v[a.ordem[1]], type: "number" },
    { header: `Distância à ${vagas}ª vaga`, value: distVaga, type: "number" },
    ...(iRival !== iFoco ? [
      { header: `Votos ${nomeS(iRival)}`, value: (a: Area) => a.v[iRival], type: "number" as const },
      { header: `Diferença para ${nomeS(iRival)}`, value: (a: Area) => a.vFoco - a.v[iRival], type: "number" as const },
    ] : []),
  ];

  if (votos.error || totais.error) return <ErrorBox error={votos.error ?? totais.error} />;
  if (!porSenador) return <Loading texto="Carregando votos do Senado…" />;

  const nomeEscopo = municipio ? titulo(base.munByCd.get(municipio)?.nome ?? "") : `o estado (${uf})`;
  const unid = porBairro ? "bairros" : "cidades";
  const ultimaVaga = ranking.ordem[vagas - 1], primeiroFora = ranking.ordem[vagas];
  const margem = posEscopo <= vagas ? ranking.tot[iFoco] - ranking.tot[primeiroFora] : ranking.tot[iFoco] - ranking.tot[ultimaVaga];
  const dadosFoco = porSenador[iFoco];

  return (
    <div className="flex flex-col gap-5">
      {/* ---- resumo ---- */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Stat valor={fmt(ranking.tot[iFoco])} rotulo={municipio ? `votos em ${nomeEscopo}` : "votos no estado"} />
        <Stat valor={ranking.validos ? pct(ranking.tot[iFoco] / ranking.validos) : "–"} rotulo="dos votos válidos para o Senado" />
        <Stat valor={ord(posEscopo)} rotulo={`lugar ${municipio ? "na cidade" : "no estado"} (${vagas} vagas)`} />
        <Stat valor={<span className={margem >= 0 ? "text-accent" : "text-danger"}>{sinal(margem)}{fmt(margem)}</span>}
          rotulo={posEscopo <= vagas ? `de vantagem sobre ${nomeS(primeiroFora)} (${ord(vagas + 1)})` : `para alcançar ${nomeS(ultimaVaga)} (${ord(vagas)})`} />
        <div className="ml-auto">
          <MunicipioSelect base={base} value={municipio} onChange={setMunicipio} />
        </div>
      </div>

      {/* ---- ranking do Senado no escopo ---- */}
      <section aria-label="Resultado do Senado" className="flex flex-col gap-2">
        <h2 className="display text-2xl">Senado {municipio ? `em ${nomeEscopo}` : "no estado"}</h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                <th className="border-b border-line px-3 py-2">#</th>
                <th className="border-b border-line px-3 py-2">Candidatura</th>
                <th className="border-b border-line px-3 py-2 text-right">Votos</th>
                <th className="border-b border-line px-3 py-2 text-right">% válidos</th>
                <th className="border-b border-line px-3 py-2 text-right">{unid} em 1º</th>
                <th className="border-b border-line px-3 py-2 text-right">{unid} no top {vagas}</th>
              </tr>
            </thead>
            <tbody>
              {ranking.ordem.map((s, k) => {
                const c = senadores[s], foco = s === iFoco;
                return (
                  <tr key={c.id} className={foco ? "bg-accent-soft font-semibold" : "hover:bg-accent-soft/50"}>
                    <td className="num border-b border-line px-3 py-1.5">{k + 1}</td>
                    <td className="border-b border-line px-3 py-1.5">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                        style={{ background: cssRgb(corSenador.get(s) ?? OUTROS) }} aria-hidden />
                      {c.numero} · {titulo(c.nome)} <span className="text-muted font-normal">{c.partido}</span>
                      <SituacaoBadge c={c} compacto />
                    </td>
                    <td className="num border-b border-line px-3 py-1.5 text-right">{fmt(ranking.tot[s])}</td>
                    <td className="num border-b border-line px-3 py-1.5 text-right">{pct(ranking.tot[s] / ranking.validos)}</td>
                    <td className="num border-b border-line px-3 py-1.5 text-right">{fmt(ranking.venceu[s])}</td>
                    <td className="num border-b border-line px-3 py-1.5 text-right">{fmt(ranking.noTop[s])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Cada eleitor vota em {vagas} nomes para o Senado: as porcentagens dos válidos somam {vagas * 100}%.
          {municipio ? "" : " Situação (eleito) conforme o TSE."}
        </p>
      </section>

      {/* ---- filtros ---- */}
      <section aria-label="Filtros" className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-3">
        <div className="flex flex-wrap items-end gap-3">
          {!municipio && (
            <label className="flex flex-col gap-1 text-sm text-muted">
              Ver por
              <Segmented label="Nível" value={nivelEstado} onChange={(v) => { setNivelEstado(v); setFPorte(""); }} options={[
                { id: "municipio", label: "Cidade" }, { id: "bairro", label: "Bairro" },
              ]} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm text-muted">
            Posição de {nomeS(iFoco)}
            <Segmented label="Posição" value={fPos} onChange={setFPos} options={[
              { id: "todas", label: "Todas" }, { id: "1", label: "1º lugar" },
              { id: "top", label: `Top ${vagas}` }, { id: "fora", label: `Fora do top ${vagas}` },
            ]} />
          </label>
          <label htmlFor="rival" className="flex flex-col gap-1 text-sm text-muted">
            Comparar com
            <select id="rival" value={rival?.id ?? ""} onChange={(e) => setRivalSel(Number(e.target.value))}
              className="rounded-md border border-line bg-panel px-3 py-1.5 text-ink">
              {ranking.ordem.filter((s) => s !== iFoco).map((s) => (
                <option key={senadores[s].id} value={senadores[s].id}>{ord(ranking.ordem.indexOf(s) + 1)} · {nomeS(s)} ({senadores[s].partido})</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            Contra {nomeS(iRival)}
            <Segmented label="Contra o adversário" value={fRival} onChange={setFRival} options={[
              { id: "todas", label: "Todas" }, { id: "frente", label: "À frente" }, { id: "atras", label: "Atrás" },
            ]} />
          </label>
          <label htmlFor="porte" className="flex flex-col gap-1 text-sm text-muted">
            Tamanho ({porBairro ? "bairro" : "cidade"})
            <select id="porte" value={fPorte} onChange={(e) => setFPorte(e.target.value)}
              className="rounded-md border border-line bg-panel px-3 py-1.5 text-ink">
              <option value="">Todos</option>
              {portes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          {!municipio && regioes.length > 0 && (
            <label htmlFor="regiao" className="flex flex-col gap-1 text-sm text-muted">
              Região (IBGE)
              <select id="regiao" value={fRegiao} onChange={(e) => setFRegiao(e.target.value)}
                className="rounded-md border border-line bg-panel px-3 py-1.5 text-ink">
                <option value="">Todas</option>
                {regioes.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          )}
          {filtroAtivo && (
            <button type="button" onClick={limpar} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-accent-soft">
              Limpar filtros
            </button>
          )}
        </div>
        <p className="text-sm">
          <b className="num">{fmt(filtradas.length)}</b> de {fmt(areas.length)} {unid}
          {" · "}<b className="num">{fmt(resumoFiltro.v)}</b> votos de {nomeS(iFoco)}
          {totalFocoEscopo ? <> ({pct(resumoFiltro.v / totalFocoEscopo, 1)} do total)</> : null}
          {" · "}{resumoFiltro.val ? pct(resumoFiltro.v / resumoFiltro.val) : "–"} dos válidos
          {" · "}1º lugar em <b className="num">{fmt(resumoFiltro.p1)}</b>, top {vagas} em <b className="num">{fmt(resumoFiltro.top)}</b>
          {iRival !== iFoco && <>{" · "}à frente de {nomeS(iRival)} em <b className="num">{fmt(resumoFiltro.frente)}</b></>}
        </p>
      </section>

      {/* ---- mapa ---- */}
      <section aria-label="Mapa" className="flex flex-col gap-2">
        <Segmented label="O que o mapa mostra" value={modoMapa} onChange={setModoMapa} options={[
          { id: "posicao", label: `Posição de ${nomeS(iFoco)}` },
          { id: "vencedor", label: "Quem ficou em 1º" },
          { id: "pct", label: `% de ${nomeS(iFoco)}` },
          { id: "rival", label: `${nomeS(iFoco)} × ${nomeS(iRival)}` },
        ]} />
        <LazyMap base={base} dados={dadosFoco} municipio={municipio} modo={municipio ? "territorios" : porBairro ? "escolas" : "municipios"} metrica="pct"
          corPorMunicipio={porBairro ? undefined : corPorMunicipio} corPorLocal={porBairro ? corPorLocal : undefined}
          infoExtra={infoExtra} rotuloSerie={`votos de ${nomeS(iFoco)}`}
          onMunicipio={(cd) => setMunicipio(cd)} />
        <Legenda modo={modoMapa} cat={[...corSenador.entries()].map(([s, c]) => ({ nome: nomeS(s), c }))} outros={OUTROS}
          div={DIV} foco={nomeS(iFoco)} rival={nomeS(iRival)} breaks={breaksPct} apagado={filtroAtivo ? APAGADO : null} />
        {porBairro && <p className="text-xs text-muted">
          {municipio ? "Com uma cidade escolhida, cada território (área mais próxima de um local de votação) recebe a cor do seu bairro."
            : "Por bairro no estado: cada ponto é um local de votação, com a cor do resultado do seu bairro."}
        </p>}
      </section>

      {/* ---- tabela ---- */}
      <section aria-label="Tabela" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="display text-2xl">{porBairro ? (municipio ? "Por bairro" : "Por bairro (todo o estado)") : "Por cidade"}</h2>
        </div>
        <DataTable data={filtradas} columns={columns} exportCols={exportCols}
          nomeArquivo={`senado_${cand.numero}_${porBairro ? `bairros_${municipio ?? uf}` : "cidades"}`}
          busca={(a) => `${a.nome} ${a.municipio} ${a.regiao ?? ""}`} initialSort={[{ id: "v", desc: true }]} />
        {!municipio && !porBairro && <p className="text-xs text-muted">Clique numa cidade do mapa ou escolha na abrangência para ver os bairros só dela.</p>}
      </section>
    </div>
  );
}

function Legenda({ modo, cat, outros, div, foco, rival, breaks, apagado }: {
  modo: ModoMapa; cat: { nome: string; c: RGB }[]; outros: RGB; div: RGB[]; foco: string; rival: string;
  breaks: number[]; apagado: RGB | null;
}) {
  const r = ramp();
  const itens: { c: RGB; label: string }[] =
    modo === "vencedor" ? [...cat.map((x) => ({ c: x.c, label: x.nome })), { c: outros, label: "Outros" }]
    : modo === "posicao" ? [{ c: r[6], label: "1º" }, { c: r[4], label: "2º" }, { c: r[2], label: "3º" }, { c: r[1], label: "4º–5º" }, { c: r[0], label: "6º ou pior" }]
    : modo === "rival" ? [
      { c: div[0], label: `${rival} +5 p.p. ou mais` }, { c: div[1], label: `${rival} +1 a 5` }, { c: div[2], label: "empate (±1 p.p.)" },
      { c: div[3], label: `${foco} +1 a 5` }, { c: div[4], label: `${foco} +5 p.p. ou mais` }]
    : r.map((c, i) => ({ c, label: i === 0 ? `até ${pct(breaks[0] ?? 0, 1)}` : i === r.length - 1 ? `${pct(breaks[i - 1] ?? 0, 1)}+` : `${pct(breaks[i - 1] ?? 0, 1)}` }));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda">
      {itens.map((x) => (
        <span key={x.label} className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm" style={{ background: cssRgb(x.c) }} aria-hidden />{x.label}
        </span>
      ))}
      {apagado && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm border border-line" style={{ background: cssRgb(apagado) }} aria-hidden />fora do filtro
        </span>
      )}
    </div>
  );
}
