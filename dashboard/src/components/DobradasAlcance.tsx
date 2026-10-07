import { candidaturaProvavel } from "../lib/paginas";
import { TituloTabela } from "./DataTable";
import { useMemo } from "react";
import type { Base, LinhaAgregada } from "../lib/data";
import { dec, fmt, pct, titulo } from "../lib/format";
import { L, getLang } from "../lib/i18n";
import { LOC, fmtFaixa, fmtNum, mediana, somaFaixas, custoPorMil, fmtCusto } from "../lib/meta";
import type { MetaMencao } from "../lib/source";
import { CARGOS } from "../lib/types";
import { spearman } from "./AnunciosVotos";
import { SituacaoBadge, nomeCand } from "./ui";

/*
 * Alcance das dobradas × votação, por campanha aliada (quem pagou anúncios citando a candidatura).
 * Exposição: impressões (faixas acumuladas, somáveis entre anúncios) e alcance mediano por anúncio (alcance não se soma:
 * a mesma pessoa pode ver vários). A Meta não informa alcance por cidade; nada é dividido entre cidades.
 * Votação: % dos válidos da candidatura nas cidades que os anúncios do aliado incluíram × no restante do estado.
 */
interface Linha {
  chave: string; nome: string; sub: string; cand?: ReturnType<Base["candById"]["get"]>;
  anuncios: number; impMin: number; impMax: number | null; alcMed: number | null; gasto: { min: number; max: number | null } | undefined;
  cidades: number; pctDentro: number | null; pctFora: number | null; dif: number | null; votosDentro: number;
  custo: { min: number; max: number | null } | null;
}

export function DobradasAlcance({ base, mencoes, votosMun, nome }: {
  base: Base; mencoes: MetaMencao[]; votosMun: Map<string, LinhaAgregada>; nome: string;
}) {
  const r = useMemo(() => {
    const totVotos = [...votosMun.values()].reduce((s, l) => s + l.votos, 0);
    const totVal = [...votosMun.values()].reduce((s, l) => s + l.validos, 0);
    const grupos = new Map<string, MetaMencao[]>();
    for (const m of mencoes) {
      if (m.papel !== "recebe") continue;
      const k = m.outra == null ? `pag:${m.ad.page_id}` : String(m.outra);
      grupos.set(k, [...(grupos.get(k) ?? []), m]);
    }
    const linhas: Linha[] = [...grupos.entries()].map(([chave, ms]) => {
      const ads = [...new Map(ms.map((m) => [m.ad.id, m.ad])).values()];
      const imp = somaFaixas(ads, "impressoes").get("");
      const cds = new Set(ads.flatMap((a) => a.loc.filter((l) => !l[LOC.excluida] && l[LOC.cd] && l[LOC.status] === "validada").map((l) => l[LOC.cd]!)));
      let vD = 0, valD = 0;
      for (const cd of cds) { const v = votosMun.get(cd); if (v) { vD += v.votos; valD += v.validos; } }
      const pctDentro = valD ? vD / valD : null;
      const pctFora = totVal - valD > 0 ? (totVotos - vD) / (totVal - valD) : null;
      const cand = chave.startsWith("pag:") ? undefined : base.candById.get(Number(chave));
      return {
        chave, cand, nome: cand ? nomeCand(cand) : ads[0]?.page_name ?? L("página não identificada", "unidentified Page"),
        sub: cand ? `${CARGOS[cand.cargo]} · ${cand.partido}` : (() => {
          const pv = candidaturaProvavel(base, ads[0]?.page_name);
          const sem = L("financiador não identificado no TSE", "funder not identified in TSE records");
          return pv ? `${sem} · ${L("provável", "likely")}: ${nomeCand(pv)}, ${CARGOS[pv.cargo]}, ${pv.partido}` : sem;
        })(),
        anuncios: ads.length, impMin: imp?.min ?? 0, impMax: imp ? imp.max : 0,
        alcMed: mediana(ads.map((a) => a.alcance).filter((x): x is number => x != null)),
        gasto: somaFaixas(ads, "gasto").get("BRL"), cidades: cds.size, pctDentro, pctFora,
        dif: pctDentro != null && pctFora != null && cds.size ? pctDentro - pctFora : null, votosDentro: vD, custo: custoPorMil(ads),
      };
    }).sort((a, b) => b.impMin - a.impMin);
    const comCidade = linhas.filter((l) => l.dif != null);
    const rho = spearman(comCidade.map((l) => l.impMin), comCidade.map((l) => l.dif!));
    const imp = somaFaixas(mencoes.filter((m) => m.papel === "recebe").map((m) => m.ad).filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i), "impressoes").get("");
    return { linhas, rho, nCidades: comCidade.length, imp, pctEstado: totVal ? totVotos / totVal : null };
  }, [mencoes, votosMun, base]);

  if (!r.linhas.length) return null;
  const top = r.linhas[0];
  return (
    <section aria-label={L("Alcance das dobradas e votação", "Joint-ticket reach and votes")} className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <h3 className="display text-xl">{L("Alcance das dobradas × votação", "Joint-ticket reach × votes")}</h3>
      <p className="text-sm leading-relaxed">
        {getLang() === "en" ? <>
        {fmt(r.linhas.length)} campaigns paid for ads mentioning {titulo(nome)}, totaling <b>{r.imp ? fmtFaixa(r.imp.min, r.imp.max) : "–"}</b> impressions.
        {top.dif != null && <> The largest exposure came from {titulo(top.nome.replace(/^\d+ · /, ""))} ({fmtFaixa(top.impMin, top.impMax)} impressions in {fmt(top.cidades)} cities),
          where {titulo(nome)} got <b>{pct(top.pctDentro!)}</b> of valid votes, versus {pct(top.pctFora!)} in the rest of the state.</>}
        {" "}Among the {fmt(r.nCidades)} campaigns with targeted cities, the rank correlation between impressions and the vote
        difference (inside − outside) is {Number.isFinite(r.rho) ? <b>{dec(r.rho, 2)}</b> : <>not computed (at least 5 such campaigns are needed)</>}.
        </> : <>
        {fmt(r.linhas.length)} campanhas pagaram anúncios citando {titulo(nome)}, somando <b>{r.imp ? fmtFaixa(r.imp.min, r.imp.max) : "–"}</b> impressões.
        {top.dif != null && <> A maior exposição foi de {titulo(top.nome.replace(/^\d+ · /, ""))} ({fmtFaixa(top.impMin, top.impMax)} impressões em {fmt(top.cidades)} cidades),
          onde {titulo(nome)} teve <b>{pct(top.pctDentro!)}</b> dos válidos, contra {pct(top.pctFora!)} no restante do estado.</>}
        {" "}Entre as {fmt(r.nCidades)} campanhas com cidades segmentadas, a correlação de postos entre impressões e a diferença de
        votação (dentro − fora) {Number.isFinite(r.rho) ? <>é <b>{dec(r.rho, 2)}</b></> : <>não foi calculada (são necessárias pelo menos 5 campanhas assim)</>}.
        </>}
      </p>
      <div className="overflow-x-auto">
        <TituloTabela>{L("Anúncios pagos de dobrada (Meta), por campanha que pagou: exposição e votação", "Paid joint-ticket ads (Meta), by paying campaign: exposure and votes")}</TituloTabela>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted">
            <th className="py-1 pr-3">{L("Campanha que pagou", "Paying campaign")}</th><th className="pr-3 text-right">{L("Anúncios", "Ads")}</th><th className="pr-3 text-right">{L("Impressões", "Impressions")}</th>
            <th className="pr-3 text-right">{L("Alcance por anúncio (mediana)", "Reach per ad (median)")}</th><th className="pr-3 text-right">{L("Gasto (do pagador)", "Spend (by payer)")}</th><th className="pr-3 text-right">{L("Custo por mil alcançados", "Cost per 1,000 reached")}</th>
            <th className="pr-3 text-right">{L("Cidades segmentadas", "Targeted cities")}</th><th className="pr-3 text-right">{L(`% válidos de ${titulo(nome).split(" ")[0]} nessas cidades`, `${titulo(nome).split(" ")[0]}'s % of valid votes in these cities`)}</th>
            <th className="pr-3 text-right">{L("no resto do estado", "in the rest of the state")}</th><th className="text-right">{L("Diferença", "Difference")}</th>
          </tr></thead>
          <tbody>{r.linhas.slice(0, 15).map((l) => (
            <tr key={l.chave} className="border-t border-line">
              <td className="py-1.5 pr-3">{l.nome}{l.cand && <SituacaoBadge c={l.cand} compacto />}<div className="text-xs text-muted">{l.sub}</div></td>
              <td className="num whitespace-nowrap pr-3 text-right">{fmt(l.anuncios)}</td>
              <td className="num whitespace-nowrap pr-3 text-right">{fmtFaixa(l.impMin, l.impMax)}</td>
              <td className="num whitespace-nowrap pr-3 text-right">{l.alcMed != null ? fmtNum(l.alcMed) : <span className="text-xs text-muted">{L("sem alcance", "no reach")}</span>}</td>
              <td className="num whitespace-nowrap pr-3 text-right">{l.gasto ? fmtFaixa(l.gasto.min, l.gasto.max, "R$ ") : <span className="text-xs text-muted">{L("sem gasto declarado", "no declared spend")}</span>}</td>
              <td className="num whitespace-nowrap pr-3 text-right">{fmtCusto(l.custo)}</td>
              <td className="num whitespace-nowrap pr-3 text-right">{l.cidades ? fmt(l.cidades) : <span className="text-xs text-muted">{L("nenhuma (estado inteiro)", "none (whole state)")}</span>}</td>
              {l.cidades && l.dif != null ? <>
                <td className="num whitespace-nowrap pr-3 text-right">{pct(l.pctDentro!)}</td>
                <td className="num whitespace-nowrap pr-3 text-right">{pct(l.pctFora!)}</td>
                <td className={`num whitespace-nowrap text-right ${l.dif >= 0 ? "text-accent" : "text-danger"}`}>
                  {`${l.dif > 0 ? "+" : ""}${dec(l.dif * 100, 1)} ${L("p.p.", "pp")}`}
                </td>
              </> : (
                <td colSpan={3} className="text-right text-xs text-muted">
                  {L("anúncios para o estado inteiro, sem cidades escolhidas: não há como comparar dentro × fora",
                    "whole-state ads, no cities chosen: no inside × outside comparison possible")}
                </td>
              )}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {getLang() === "en" ? <>
        Impressions: sum of the ads' ranges (views, not people). Reach: median per ad (not summed across ads).
        Meta does not report reach or impressions by city, so the comparison is by allied campaign: {titulo(nome)}'s vote share in the
        cities the ally's ads included, versus the rest of the state. Descriptive: the ally may have chosen cities where
        both already had a strong base. Difference in percentage points of valid votes.
        </> : <>
        Impressões: soma das faixas dos anúncios (exibições, não pessoas). Alcance: mediana por anúncio (não se soma entre anúncios).
        A Meta não informa alcance nem impressões por cidade; por isso a comparação é por campanha aliada: votação de {titulo(nome)} nas
        cidades que os anúncios do aliado incluíram, contra o restante do estado. Descritivo: o aliado pode ter escolhido cidades onde
        a base dos dois já era forte. Diferença em pontos percentuais dos válidos.
        </>}
      </p>
    </section>
  );
}
