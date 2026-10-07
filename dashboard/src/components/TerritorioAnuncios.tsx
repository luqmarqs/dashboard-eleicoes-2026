import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Base, LinhaAgregada } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { fmt, pct, titulo } from "../lib/format";
import { L, getLang } from "../lib/i18n";
import { abrangencia, fmtData, fmtFaixa, mediana, porMunicipio, somaFaixas, custoPorMil, fmtCusto } from "../lib/meta";
import { geoUrl, type MetaAnuncio } from "../lib/source";
import { EIXOS, normalizarTexto, rotuloDe, temasDoTexto } from "../lib/temas";
import { useUf } from "../lib/uf";
import { DataTable } from "./DataTable";
import { Segmented } from "./ui";

/*
 * Anúncios pagos (Meta) por território: resumo do estado + tabela de cidades com filtros e leituras prontas.
 * Por cidade: anúncios que a incluem (inteira ou por bairro) e que a excluem, veiculação e o gasto TOTAL desses anúncios
 * (em todos os lugares em que circularam — a Meta não informa gasto por cidade). Filtro de tema: só os anúncios cujo
 * texto trata do tema (classificação por termos, a mesma do card de temas).
 */

interface Linha {
  cd: string; nome: string; regiao: string | null; rank: number; votos: number; validos: number; pct: number; share: number;
  n: number; bairro: number; exclui: number; inicio: string | null; fim: string | null; gmin: number | null; gmax: number | null;
  custo: { min: number; max: number | null } | null;
}

type Escopo = "10" | "25" | "50" | "todas";
type Situacao = "todas" | "com" | "sem" | "excluida";
type Leitura = "nenhuma" | "lacunas" | "baixo_retorno" | "gasto";

const PORTES = () => [
  { id: "p1", label: L("até 5 mil válidos", "up to 5k valid votes"), max: 5_000 },
  { id: "p2", label: L("5 a 20 mil", "5k to 20k"), max: 20_000 },
  { id: "p3", label: L("20 a 100 mil", "20k to 100k"), max: 100_000 },
  { id: "p4", label: L("mais de 100 mil", "over 100k"), max: Infinity },
];

export function TerritorioAnuncios({ base, ads: todosAds, votosMun, nome, deTerceiros = false, tema: temaExterno = null, onTema }: {
  base: Base; ads: MetaAnuncio[]; votosMun: Map<string, LinhaAgregada>; nome: string; deTerceiros?: boolean;
  /** tema escolhido fora (ex.: card de temas); a tabela também permite escolher */
  tema?: string | null; onTema?: (t: string | null) => void;
}) {
  const { uf, info } = useUf();
  const [escopo, setEscopo] = useState<Escopo>("10");
  const [situacao, setSituacao] = useState<Situacao>("todas");
  const [regiao, setRegiao] = useState("");
  const [porte, setPorte] = useState("");
  const [leitura, setLeitura] = useState<Leitura>("nenhuma");
  const [temaLocal, setTemaLocal] = useState<string | null>(null);
  const tema = onTema ? temaExterno : temaLocal;
  const setTema = onTema ?? setTemaLocal;

  const ads = useMemo(() => (tema ? todosAds.filter((a) => temasDoTexto(normalizarTexto(a)).has(tema)) : todosAds), [todosAds, tema]);
  const temasPresentes = useMemo(() => {
    const c = new Map<string, number>();
    for (const a of todosAds) for (const t of temasDoTexto(normalizarTexto(a))) c.set(t, (c.get(t) ?? 0) + 1);
    return c;
  }, [todosAds]);

  // regiões intermediárias do IBGE (propriedade do contorno municipal; mesmo cache do mapa)
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

  const r = useMemo(() => {
    const mun = porMunicipio(ads);
    const porId = new Map(ads.map((a) => [a.id, a]));
    const votos = [...votosMun.values()];
    const total = votos.reduce((s, l) => s + l.votos, 0);
    const validos = votos.reduce((s, l) => s + l.validos, 0);
    const linhas: Linha[] = [...votos].sort((a, b) => b.votos - a.votos).map((l, i) => {
      const x = mun.get(l.key);
      const ids = new Set([...(x?.inclui ?? []), ...(x?.bairro ?? [])]);
      const adsCidade = [...ids].map((id) => porId.get(id)!).filter(Boolean);
      const g = somaFaixas(adsCidade, "gasto").get("BRL");
      return { cd: l.key, nome: l.nome, regiao: regiaoDe.get(l.key) ?? null, rank: i + 1, votos: l.votos, validos: l.validos, pct: l.pct,
        share: total ? l.votos / total : 0, n: ids.size, bairro: x?.bairro.size ?? 0, exclui: x?.exclui.size ?? 0,
        inicio: x?.inicio ?? null, fim: x?.fim ?? null, gmin: g ? g.min : null, gmax: g ? g.max : null, custo: custoPorMil(adsCidade) };
    });
    const soEstado = ads.filter((a) => abrangencia(a) === "uf").length;
    const comCidade = ads.filter((a) => ["municipio", "bairro"].includes(abrangencia(a))).length;
    const cidades = linhas.filter((l) => l.n > 0).length;
    const naUf = ads.flatMap((a) => a.entrega.filter(([u]) => u === uf).map(([, p]) => p ?? 0));
    return { linhas, total, validos, soEstado, comCidade, cidades, entregaMed: mediana(naUf), gasto: somaFaixas(ads, "gasto").get("BRL") };
  }, [ads, votosMun, uf, regiaoDe]);

  const regioes = useMemo(() => [...new Set(regiaoDe.values())].sort((a, b) => a.localeCompare(b)), [regiaoDe]);
  const portes = PORTES();

  // leituras prontas = filtro + ordenação
  const efSituacao: Situacao = leitura === "lacunas" ? "sem" : leitura === "baixo_retorno" || leitura === "gasto" ? "com" : situacao;
  const efEscopo: Escopo = leitura !== "nenhuma" ? "todas" : escopo;
  const sort: SortingState = leitura === "lacunas" ? [{ id: "votos", desc: true }] : leitura === "baixo_retorno" ? [{ id: "n", desc: true }, { id: "pct", desc: false }]
    : leitura === "gasto" ? [{ id: "gasto", desc: true }] : [{ id: "votos", desc: true }];

  const filtradas = r.linhas.filter((l) => {
    if (efEscopo !== "todas" && l.rank > Number(efEscopo)) return false;
    if (efSituacao === "com" && l.n === 0) return false;
    if (efSituacao === "sem" && (l.n > 0 || l.votos === 0)) return false;
    if (efSituacao === "excluida" && l.exclui === 0) return false;
    if (regiao && l.regiao !== regiao) return false;
    if (porte) {
      const i = portes.findIndex((p) => p.id === porte);
      const min = i > 0 ? portes[i - 1].max : 0;
      if (!(l.validos > min && l.validos <= portes[i].max)) return false;
    }
    return true;
  });

  const columns = useMemo<ColumnDef<Linha, unknown>[]>(() => [
    { id: "rank", accessorKey: "rank", header: L("Posição por votos", "Rank by votes"), cell: (x) => `${x.getValue()}º`, meta: { numeric: true } },
    { id: "nome", accessorKey: "nome", header: L("Cidade", "City"), cell: (x) => (
      <div><div className="font-semibold">{titulo(x.row.original.nome)}</div>
        {x.row.original.regiao && <div className="text-xs text-muted">{L("região", "region")} {x.row.original.regiao}</div>}</div>
    ) },
    { id: "votos", accessorKey: "votos", header: L("Votos", "Votes"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "share", accessorKey: "share", header: L("% do total", "% of total"), cell: (x) => pct(Number(x.getValue()), 1), meta: { numeric: true } },
    { id: "pct", accessorKey: "pct", header: L("% dos válidos", "% of valid votes"), cell: (x) => pct(Number(x.getValue())), meta: { numeric: true } },
    { id: "n", accessorKey: "n", header: L("Anúncios que incluem", "Ads that include it"), cell: (x) => {
      const l = x.row.original;
      return l.n ? <>{fmt(l.n)}{l.bairro ? <span className="text-xs text-muted"> ({fmt(l.bairro)} {L("por bairro", "by neighborhood")})</span> : null}</> : <span className="text-muted">{L("nenhum", "none")}</span>;
    }, meta: { numeric: true } },
    { id: "exclui", accessorKey: "exclui", header: L("Que excluem", "That exclude it"), cell: (x) => (Number(x.getValue()) ? fmt(Number(x.getValue())) : "–"), meta: { numeric: true } },
    { id: "periodo", accessorFn: (l) => l.inicio ?? "", header: L("Veiculação", "Run dates"), cell: (x) => { const l = x.row.original; return l.inicio ? `${fmtData(l.inicio)} – ${fmtData(l.fim)}` : "–"; } },
    { id: "custo", accessorFn: (l) => l.custo?.min ?? undefined, header: L("Custo por mil alcançados", "Cost per 1,000 reached"), cell: (x) => fmtCusto(x.row.original.custo), sortUndefined: "last", meta: { numeric: true } },
    { id: "gasto", accessorFn: (l) => l.gmax ?? l.gmin ?? undefined, header: L("Gasto total desses anúncios*", "Total spend of these ads*"),
      cell: (x) => { const l = x.row.original; return l.n ? fmtFaixa(l.gmin, l.gmax, "R$ ") : "–"; }, sortUndefined: "last", meta: { numeric: true } },
  ], []);
  const exportCols: ExportCol<Linha>[] = [
    { header: L("Posição por votos", "Rank by votes"), value: (l) => l.rank, type: "number" },
    { header: L("Cidade", "City"), value: (l) => l.nome }, { header: L("Código TSE", "TSE code"), value: (l) => l.cd },
    { header: L("Região intermediária (IBGE)", "IBGE intermediate region"), value: (l) => l.regiao ?? "" },
    { header: L("Votos", "Votes"), value: (l) => l.votos, type: "number" },
    { header: L("% do total", "% of total"), value: (l) => l.share, type: "percent" },
    { header: L("% dos válidos", "% of valid votes"), value: (l) => l.pct, type: "percent" },
    { header: L("Anúncios que incluem a cidade", "Ads that include the city"), value: (l) => l.n, type: "number" },
    { header: L("… por bairro", "… by neighborhood"), value: (l) => l.bairro, type: "number" },
    { header: L("Anúncios que excluem a cidade", "Ads that exclude the city"), value: (l) => l.exclui, type: "number" },
    { header: L("Primeira veiculação", "First run date"), value: (l) => l.inicio ?? "" }, { header: L("Última veiculação", "Last run date"), value: (l) => l.fim ?? "" },
    { header: L("Custo por mil alcançados - mínimo (R$)", "Cost per 1,000 reached - min (R$)"), value: (l) => l.custo?.min ?? null, type: "number" },
    { header: L("Custo por mil alcançados - máximo (R$; vazio = sem teto)", "Cost per 1,000 reached - max (R$; empty = no upper bound)"), value: (l) => l.custo?.max ?? null, type: "number" },
    { header: L("Gasto total dos anúncios - mínimo (não é gasto na cidade)", "Total ad spend - min (not spend in the city)"), value: (l) => (l.n ? l.gmin : null), type: "number" },
    { header: L("Gasto total dos anúncios - máximo (vazio = sem teto)", "Total ad spend - max (empty = no upper bound)"), value: (l) => (l.n ? l.gmax : null), type: "number" },
  ];

  const leituras: { id: Leitura; label: string; ajuda: string }[] = [
    { id: "nenhuma", label: L("Nenhuma", "None"), ajuda: "" },
    { id: "lacunas", label: L("Votos altos sem anúncio", "High votes, no ads"), ajuda: L("Cidades com voto e nenhum anúncio que as inclua, das mais votadas para as menos", "Cities with votes and no ad including them, most votes first") },
    { id: "baixo_retorno", label: L("Muitos anúncios, votação baixa", "Many ads, low vote share"), ajuda: L("Cidades com mais anúncios e, entre elas, menor % dos válidos", "Cities with the most ads and, among them, the lowest % of valid votes") },
    { id: "gasto", label: L("Onde mais se gastou", "Most spend"), ajuda: L("Cidades cujos anúncios somam mais gasto (total dos anúncios, não gasto local)", "Cities whose ads add up to the most spend (ad totals, not local spend)") },
  ];
  const temasOpc = EIXOS.flatMap((e) => e.temas.filter((t) => temasPresentes.get(t.id)).map((t) => ({ e, t, n: temasPresentes.get(t.id)! })));
  const rotuloTema = tema ? rotuloDe(EIXOS.flatMap((e) => e.temas).find((t) => t.id === tema)!) : null;

  return (
    <section aria-label={L("Anúncios pagos por território", "Paid ads by territory")} className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <h3 className="display text-xl">{L("Anúncios pagos (Meta) por território", "Paid ads (Meta) by territory")}</h3>
      <p className="text-sm leading-relaxed">
        <b>{L("Estado", "State")} {info.sigla}:</b> {fmt(r.total)} {L("votos", "votes")} ({r.validos ? pct(r.total / r.validos) : "–"} {L("dos válidos", "of valid votes")}) ·{" "}
        {getLang() === "en"
          ? <>{fmt(ads.length)} ads{deTerceiros ? " from other campaigns" : ""}{rotuloTema ? ` on "${rotuloTema}"` : ""}: {fmt(r.soEstado)} for the whole state, {fmt(r.comCidade)} with cities or neighborhoods ({fmt(r.cidades)} cities)</>
          : <>{fmt(ads.length)} anúncios{deTerceiros ? " de outras campanhas" : ""}{rotuloTema ? ` sobre "${rotuloTema}"` : ""}: {fmt(r.soEstado)} para o estado inteiro, {fmt(r.comCidade)} com cidades ou bairros ({fmt(r.cidades)} cidades)</>}
        {r.entregaMed != null && <> · {L("mediana de", "median of")} {pct(r.entregaMed, 0)} {L("do alcance entregue em", "of reach delivered in")} {info.sigla}</>}
        {r.gasto && <> · {L("gasto declarado", "declared spend")} {fmtFaixa(r.gasto.min, r.gasto.max, "R$ ")}</>}
        {custoPorMil(ads) && <> · {L("custo por mil alcançados", "cost per 1,000 reached")} {fmtCusto(custoPorMil(ads))}</>}
      </p>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-muted">{L("Leitura pronta", "Preset")}
          <Segmented label={L("Leitura pronta", "Preset")} value={leitura} onChange={setLeitura} options={leituras.map((x) => ({ id: x.id, label: x.label, ajuda: x.ajuda }))} />
        </label>
        <label className="flex flex-col gap-1 text-muted">{L("Cidades", "Cities")}
          <Segmented label={L("Quantas cidades", "How many cities")} value={efEscopo} onChange={(v) => { setEscopo(v); setLeitura("nenhuma"); }} options={[
            { id: "10", label: L("10 mais votadas", "Top 10 by votes") }, { id: "25", label: "25" }, { id: "50", label: "50" }, { id: "todas", label: L("Todas", "All") },
          ]} />
        </label>
        <label htmlFor="terr-tema" className="flex flex-col gap-1 text-muted">{L("Tema do criativo", "Creative theme")}
          <select id="terr-tema" value={tema ?? ""} onChange={(e) => setTema(e.target.value || null)} className="max-w-56 rounded-md border border-line bg-panel px-2 py-1 text-ink">
            <option value="">{L("Todos os temas", "All themes")}</option>
            {EIXOS.map((e) => {
              const ts = temasOpc.filter((x) => x.e.id === e.id);
              return ts.length ? (
                <optgroup key={e.id} label={rotuloDe(e)}>
                  {ts.map(({ t, n }) => <option key={t.id} value={t.id}>{rotuloDe(t)} ({fmt(n)})</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <label htmlFor="terr-sit" className="flex flex-col gap-1 text-muted">{L("Anúncios na cidade", "Ads in the city")}
          <select id="terr-sit" value={efSituacao} onChange={(e) => { setSituacao(e.target.value as Situacao); setLeitura("nenhuma"); }}
            className="rounded-md border border-line bg-panel px-2 py-1 text-ink">
            <option value="todas">{L("Todas as cidades", "All cities")}</option>
            <option value="com">{L("Com anúncio que inclui a cidade", "With ads including the city")}</option>
            <option value="sem">{L("Sem nenhum anúncio (e com votos)", "No ads (and with votes)")}</option>
            <option value="excluida">{L("Excluídas por algum anúncio", "Excluded by some ad")}</option>
          </select>
        </label>
        {regioes.length > 0 && (
          <label htmlFor="terr-reg" className="flex flex-col gap-1 text-muted">{L("Região (IBGE)", "Region (IBGE)")}
            <select id="terr-reg" value={regiao} onChange={(e) => setRegiao(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1 text-ink">
              <option value="">{L("Todas", "All")}</option>
              {regioes.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        )}
        <label htmlFor="terr-porte" className="flex flex-col gap-1 text-muted">{L("Tamanho da cidade", "City size")}
          <select id="terr-porte" value={porte} onChange={(e) => setPorte(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1 text-ink">
            <option value="">{L("Todos", "All")}</option>
            {portes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {(leitura !== "nenhuma" || situacao !== "todas" || regiao || porte || escopo !== "10" || tema) && (
          <button type="button" onClick={() => { setLeitura("nenhuma"); setSituacao("todas"); setRegiao(""); setPorte(""); setEscopo("10"); setTema(null); }}
            className="rounded-md border border-line px-3 py-1 hover:bg-accent-soft">{L("Limpar", "Clear")}</button>
        )}
      </div>
      {leitura !== "nenhuma" && <p className="text-xs text-muted">{leituras.find((x) => x.id === leitura)?.ajuda}.</p>}

      <DataTable key={leitura}
        titulo={L(`Votos de ${titulo(nome)} e anúncios pagos (Meta)${deTerceiros ? " de outras campanhas que a citam" : ""}${rotuloTema ? ` sobre "${rotuloTema}"` : ""}, por cidade`,
          `${titulo(nome)} votes and paid ads (Meta)${deTerceiros ? " from other campaigns mentioning them" : ""}${rotuloTema ? ` on "${rotuloTema}"` : ""}, by city`)}
        data={filtradas} columns={columns} exportCols={exportCols} nomeArquivo={`anuncios_territorio_${uf}${tema ? `_${tema}` : ""}`}
        busca={(l) => `${l.nome} ${l.regiao ?? ""}`} initialSort={sort} pageSize={efEscopo === "10" ? 10 : 25} />
      <p className="text-xs text-muted">
        {deTerceiros && <>{getLang() === "en" ? <>{titulo(nome)} has no ads of their own: figures come from other campaigns' ads that mention them (joint tickets). </> : <>{titulo(nome)} não tem anúncios próprios: os números são dos anúncios de outras campanhas que a citam (dobradas). </>}</>}
        {L("* Gasto acumulado dos anúncios que incluem a cidade, somando o que gastaram em todos os lugares: não é gasto na cidade, e o mesmo anúncio conta em cada cidade que inclui. Anúncios para o estado inteiro não aparecem nas cidades. A entrega por estado é a única informada pela Meta. Tema: classificação do texto por termos (a mesma do card de temas).",
          "* Accumulated spend of the ads that include the city, adding up what they spent everywhere: it is not spend in the city, and the same ad counts in every city it includes. Whole-state ads do not appear in the cities. Delivery by state is the only breakdown Meta provides. Theme: keyword classification of the ad text (same as the themes card).")}
      </p>
    </section>
  );
}
