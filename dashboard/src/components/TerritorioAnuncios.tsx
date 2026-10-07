import { useMemo } from "react";
import type { Base, LinhaAgregada } from "../lib/data";
import { fmt, pct, titulo } from "../lib/format";
import { L, getLang } from "../lib/i18n";
import { abrangencia, fmtData, fmtFaixa, mediana, porMunicipio, somaFaixas } from "../lib/meta";
import type { MetaAnuncio } from "../lib/source";
import { useUf } from "../lib/uf";

/*
 * Leitura territorial do tráfego pago: o estado e as 10 cidades com mais votos da candidatura.
 * Por cidade: anúncios que a incluem (inteira ou por bairro) e que a excluem, veiculação e o gasto TOTAL desses anúncios
 * (em todos os lugares em que circularam — a Meta não informa gasto por cidade). No estado: alcance entregue na UF.
 */
export function TerritorioAnuncios({ base, ads, votosMun, nome, deTerceiros = false }: {
  base: Base; ads: MetaAnuncio[]; votosMun: Map<string, LinhaAgregada>; nome: string; deTerceiros?: boolean;
}) {
  const { uf, info } = useUf();
  const r = useMemo(() => {
    const mun = porMunicipio(ads);
    const porId = new Map(ads.map((a) => [a.id, a]));
    const votos = [...votosMun.values()];
    const total = votos.reduce((s, l) => s + l.votos, 0);
    const validos = votos.reduce((s, l) => s + l.validos, 0);
    const top = [...votos].sort((a, b) => b.votos - a.votos).slice(0, 10).map((l) => {
      const x = mun.get(l.key);
      const ids = new Set([...(x?.inclui ?? []), ...(x?.bairro ?? [])]);
      const g = somaFaixas([...ids].map((i) => porId.get(i)!).filter(Boolean), "gasto").get("BRL");
      return { l, n: ids.size, bairro: x?.bairro.size ?? 0, exclui: x?.exclui.size ?? 0, inicio: x?.inicio ?? null, fim: x?.fim ?? null, g };
    });
    const soEstado = ads.filter((a) => abrangencia(a) === "uf").length;
    const comCidade = ads.filter((a) => ["municipio", "bairro"].includes(abrangencia(a))).length;
    const cidades = [...mun.values()].filter((x) => x.inclui.size + x.bairro.size > 0 && base.munByCd.has(x.cd)).length;
    const naUf = ads.flatMap((a) => a.entrega.filter(([u]) => u === uf).map(([, p]) => p ?? 0));
    return { top, total, validos, soEstado, comCidade, cidades, entregaMed: mediana(naUf), comEntrega: naUf.length,
      gasto: somaFaixas(ads, "gasto").get("BRL") };
  }, [ads, votosMun, base, uf]);

  return (
    <section aria-label={L("Território", "Territory")} className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <h3 className="display text-xl">{L("Território: estado e 10 principais cidades", "Territory: state and top 10 cities")}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted">
            <th className="py-1 pr-3">{L("Recorte", "Area")}</th><th className="pr-3 text-right">{L("Votos", "Votes")}</th><th className="pr-3 text-right">{L("% do total", "% of total")}</th>
            <th className="pr-3 text-right">{L("% dos válidos", "% of valid votes")}</th><th className="pr-3 text-right">{L("Anúncios que incluem", "Ads that include")}</th>
            <th className="pr-3 text-right">{L("que excluem", "that exclude")}</th><th className="pr-3">{L("Veiculação", "Run dates")}</th><th className="text-right">{L("Gasto total desses anúncios*", "Total spend of these ads*")}</th>
          </tr></thead>
          <tbody>
            <tr className="border-t border-line bg-accent-soft/40 font-semibold">
              <td className="py-1.5 pr-3">{L("Estado", "State")} {info.sigla}
                <div className="text-xs font-normal text-muted">
                  {getLang() === "en" ? <>
                  {fmt(ads.length)} ads{deTerceiros ? " from other campaigns" : ""}: {fmt(r.soEstado)} for the whole state, {fmt(r.comCidade)} with
                  cities or neighborhoods ({fmt(r.cidades)} cities){r.entregaMed != null && <> · median of {pct(r.entregaMed, 0)} of reach delivered in {info.sigla}</>}
                  </> : <>
                  {fmt(ads.length)} anúncios{deTerceiros ? " de outras campanhas" : ""}: {fmt(r.soEstado)} para o estado inteiro, {fmt(r.comCidade)} com
                  cidades ou bairros ({fmt(r.cidades)} cidades){r.entregaMed != null && <> · mediana de {pct(r.entregaMed, 0)} do alcance entregue em {info.sigla}</>}
                  </>}
                </div>
              </td>
              <td className="num whitespace-nowrap pr-3 text-right">{fmt(r.total)}</td><td className="num whitespace-nowrap pr-3 text-right">100%</td>
              <td className="num whitespace-nowrap pr-3 text-right">{r.validos ? pct(r.total / r.validos) : "–"}</td>
              <td className="num whitespace-nowrap pr-3 text-right">{fmt(ads.length)}</td><td className="pr-3 text-right">–</td><td className="pr-3">–</td>
              <td className="num whitespace-nowrap text-right">{r.gasto ? fmtFaixa(r.gasto.min, r.gasto.max, "R$ ") : "–"}</td>
            </tr>
            {r.top.map(({ l, n, bairro, exclui, inicio, fim, g }, i) => (
              <tr key={l.key} className="border-t border-line">
                <td className="py-1.5 pr-3">{i + 1}. {titulo(l.nome)}</td>
                <td className="num whitespace-nowrap pr-3 text-right">{fmt(l.votos)}</td>
                <td className="num whitespace-nowrap pr-3 text-right">{r.total ? pct(l.votos / r.total, 1) : "–"}</td>
                <td className="num whitespace-nowrap pr-3 text-right">{pct(l.pct)}</td>
                <td className="num whitespace-nowrap pr-3 text-right">{n ? <>{fmt(n)}{bairro ? <span className="text-xs text-muted"> ({fmt(bairro)} {L("por bairro", "by neighborhood")})</span> : null}</> : <span className="text-muted">{L("nenhum", "none")}</span>}</td>
                <td className="num whitespace-nowrap pr-3 text-right">{exclui ? fmt(exclui) : "–"}</td>
                <td className="pr-3 text-xs">{inicio ? `${fmtData(inicio)} – ${fmtData(fim)}` : "–"}</td>
                <td className="num whitespace-nowrap text-right">{g ? fmtFaixa(g.min, g.max, "R$ ") : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {getLang() === "en" ? <>
        {deTerceiros && <>{titulo(nome)} has no own ads: the figures are from other campaigns' ads that mention them (joint tickets). </>}
        * Cumulative spend of the ads that include the area, summing what they spent everywhere: it is not spend in the city,
        and the same ad counts in every city it includes. Ads "for the whole state" do not appear in the city rows.
        Delivery by state is the only breakdown Meta reports.
        </> : <>
        {deTerceiros && <>{titulo(nome)} não tem anúncios próprios: os números são dos anúncios de outras campanhas que a citam (dobradas). </>}
        * Gasto acumulado dos anúncios que incluem o recorte, somando o que gastaram em todos os lugares: não é gasto na cidade,
        e o mesmo anúncio conta em cada cidade que inclui. Anúncios "para o estado inteiro" não aparecem nas linhas das cidades.
        A entrega por estado é a única informada pela Meta.
        </>}
      </p>
    </section>
  );
}

