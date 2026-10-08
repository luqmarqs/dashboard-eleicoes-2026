import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { fmt, titulo } from "../lib/format";
import { L, getLang } from "../lib/i18n";
import { NOMES_INCLUIDAS, custoPorMil, custoPorVoto, fmtCusto, fmtFaixa, incluidaDeliberada, somaFaixas } from "../lib/meta";
import { useBase } from "../lib/data";
import { useMetaAnuncios, useMetaResumo } from "../lib/metaHooks";
import { source, type MetaAnuncio } from "../lib/source";
import { useUf } from "../lib/uf";

/*
 * Faixa de gasto em anúncios (Meta) no topo do painel da candidatura:
 *   próprio  = anúncios das páginas da candidatura;
 *   dobradas = anúncios pagos por OUTRAS campanhas que citam a candidatura com nome e número de urna;
 *   total    = próprio + dobradas (faixas somadas; o gasto das dobradas é de quem pagou e o anúncio pode citar várias
 *              candidaturas). Menções só pelo nome ficam fora do total, numa nota;
 *   por voto = total ÷ votos nominais da candidatura (régua de comparação, não efeito).
 */
const unicos = (xs: MetaAnuncio[]) => [...new Map(xs.map((a) => [a.id, a])).values()];

export function GastoTopo({ candId }: { candId: number }) {
  const { uf } = useUf();
  const base = useBase();
  const cand = base.data?.candById.get(candId);
  const votos = cand?.votos ?? 0;
  const resumo = useMetaResumo();
  const item = resumo.data?.candidaturas.find((c) => c.candidatura_id === candId);
  const proprios = !!item && item.anuncios > 0;
  const ads = useMetaAnuncios(candId, item?.ultima_coleta, proprios);
  const dob = useQuery({ queryKey: ["meta-dobradas", uf, candId], queryFn: () => source.metaDobradas(candId), enabled: !!resumo.data, staleTime: 5 * 60_000 });

  const r = useMemo(() => {
    const recebe = (dob.data ?? []).filter((m) => m.papel === "recebe");
    const comNumero = unicos(recebe.filter((m) => m.cita_numero).map((m) => m.ad));
    const idsNum = new Set(comNumero.map((a) => a.id));
    const soNome = unicos(recebe.filter((m) => !m.cita_numero && !idsNum.has(m.ad.id)).map((m) => m.ad));
    const prop = proprios ? ads.data ?? [] : [];
    const gp = somaFaixas(prop, "gasto").get("BRL"), gd = somaFaixas(comNumero, "gasto").get("BRL"), gs = somaFaixas(soNome, "gasto").get("BRL");
    const total = gp || gd ? { min: (gp?.min ?? 0) + (gd?.min ?? 0), max: gp?.max === null || gd?.max === null ? null : (gp?.max ?? 0) + (gd?.max ?? 0) } : null;
    // anúncios pagos pelo CNPJ da candidatura citando outras (rastro de quem não teve páginas coletadas)
    const pagaMencoes = (dob.data ?? []).filter((m) => m.papel === "paga");
    const paga = unicos(pagaMencoes.map((m) => m.ad));
    const pagaPor = new Map<number, Set<string>>();
    for (const m of pagaMencoes) if (m.outra != null) pagaPor.set(m.outra, (pagaPor.get(m.outra) ?? new Set()).add(m.ad.id));
    return { prop, comNumero, soNome, gp, gd, gs, total, custo: custoPorMil([...prop, ...comNumero]), paga, pagaPor, gpaga: somaFaixas(paga, "gasto").get("BRL") };
  }, [ads.data, dob.data, proprios]);

  // páginas da candidatura não coletadas (não está no resumo): dizer isso em vez de ficar em silêncio
  if (resumo.data && !item && base.data) {
    const eleita = !!cand?.situacao?.startsWith("Eleito");
    const citadas = [...r.pagaPor.entries()].sort((a, b2) => b2[1].size - a[1].size)
      .map(([id, s]) => ({ c: base.data!.candById.get(id), n: s.size })).filter((x) => x.c);
    const recebe = unicos((dob.data ?? []).filter((m) => m.papel === "recebe" && m.cita_numero).map((m) => m.ad)).length;
    const nada = !r.paga.length && !recebe;
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-panel p-3 text-sm" aria-label={L("Gasto em anúncios", "Ad spend")}>
        <div className="eyebrow">{L("Anúncios na Meta: cobertura", "Meta ads: coverage")}</div>
        <p>
          {eleita
            ? L("Candidatura eleita, mas nenhuma página de anúncios ligada a ela foi identificada (pode não ter anunciado, ou anunciar com outro financiador). Por isso não há gasto próprio aqui.",
              "Elected candidacy, but no ad Page linked to it was identified (it may not have advertised, or may advertise under another funder). So there is no own spend here.")
            : L(`As páginas desta candidatura não foram coletadas: a Biblioteca de Anúncios foi coletada só para as candidaturas eleitas e para ${NOMES_INCLUIDAS()}, incluídas por escolha da equipe. Não dá para dizer quanto ela gastou.`,
              `This candidacy's Pages were not collected: the Ad Library was collected only for elected candidacies and for ${NOMES_INCLUIDAS()}, included by the team's choice. It is not possible to say how much it spent.`)}
        </p>
        {r.paga.length > 0 && (
          <p>
            {L(`O que se sabe: a campanha pagou pelo menos ${fmt(r.paga.length)} anúncios que citam candidaturas coletadas`, `What is known: the campaign paid for at least ${fmt(r.paga.length)} ads mentioning collected candidacies`)}
            {citadas.length ? <> ({citadas.map((x) => <span key={x.c!.id}>{titulo(x.c!.nome)} {x.n}</span>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])})</> : null}
            {r.gpaga ? L(`, ${fmtFaixa(r.gpaga.min, r.gpaga.max, "R$ ")} declarados`, `, ${fmtFaixa(r.gpaga.min, r.gpaga.max, "R$ ")} declared`) : ""}
            {L(". São dobradas pagas por ela; os anúncios dela sem menção a outras não foram coletados.", ". These are joint-ticket ads it paid for; its ads without mentions of others were not collected.")}
          </p>
        )}
        {recebe > 0 && <p>{L(`Outras campanhas coletadas citaram a candidatura, com nome e número, em ${fmt(recebe)} anúncios.`, `Other collected campaigns mentioned the candidacy, with name and number, in ${fmt(recebe)} ${recebe === 1 ? "ad" : "ads"}.`)}</p>}
        {nada && <p className="text-muted">{L("Nenhum anúncio coletado a cita ou é pago por ela.", "No collected ad mentions it or is paid for by it.")}</p>}
      </div>
    );
  }

  if (!resumo.data || (!r.prop.length && !r.comNumero.length && !r.soNome.length)) return null;
  const faixa = (g: { min: number; max: number | null } | undefined | null) => (g ? fmtFaixa(g.min, g.max, "R$ ") : "R$ 0");
  return (
    <div className="flex flex-wrap items-stretch gap-2 text-sm" aria-label={L("Gasto em anúncios", "Ad spend")}>
      <Bloco rotulo={L("Gasto próprio em anúncios", "Own ad spend")} valor={faixa(r.gp)} sub={L(`${fmt(r.prop.length)} anúncios das páginas da candidatura`, `${fmt(r.prop.length)} ads from the candidacy's Pages`)} />
      <span className="self-center text-muted" aria-hidden>+</span>
      <Bloco rotulo={proprios ? L("Dobradas", "Joint tickets") : L("Anúncios de terceiros", "Third-party ads")} valor={faixa(r.gd)}
        sub={proprios
          ? L(`${fmt(r.comNumero.length)} anúncios de outras campanhas com nome e número (gasto delas)`, `${fmt(r.comNumero.length)} ads by other campaigns with name and number (their spend)`)
          : L(`${fmt(r.comNumero.length)} anúncios de outras campanhas que usaram por conta própria o nome e o número (gasto delas)`, `${fmt(r.comNumero.length)} ads by other campaigns that chose to use the name and number (their spend)`)} />
      <span className="self-center text-muted" aria-hidden>=</span>
      <Bloco destaque rotulo={proprios ? L("Total em anúncios", "Total in ads") : L("Total em anúncios que a citam", "Total in ads featuring it")} valor={r.total ? fmtFaixa(r.total.min, r.total.max, "R$ ") : "R$ 0"}
        sub={r.custo ? L(`${fmtCusto(r.custo)} por mil alcançados`, `${fmtCusto(r.custo)} per 1,000 reached`) : ""} />
      <span className="self-center text-muted" aria-hidden>÷</span>
      <Bloco rotulo={proprios ? L("Custo estimado por voto", "Estimated cost per vote") : L("Gasto de terceiros por voto", "Third-party spend per vote")}
        valor={custoPorVoto(r.total, votos) ? fmtCusto(custoPorVoto(r.total, votos)) : L("sem gasto", "no spend")}
        sub={L(`${fmt(votos)} votos no 1º turno`, `${fmt(votos)} votes in the 1st round`) + (proprios && r.gd && custoPorVoto(r.gp, votos) ? L(` · só gasto próprio: ${fmtCusto(custoPorVoto(r.gp, votos))}`, ` · own spend only: ${fmtCusto(custoPorVoto(r.gp, votos))}`) : "")} />
      <p className="w-full text-xs text-muted">
        {cand && !cand.situacao?.startsWith("Eleito") && incluidaDeliberada(uf, cand.cargo, cand.numero) && (
          <><b>{L("Candidatura não eleita, incluída na coleta por escolha deliberada da equipe.", "Candidacy not elected; included in the collection by the team's deliberate choice.")}</b>{" "}</>
        )}
        {getLang() === "en"
          ? <>{!proprios && <><b>The candidacy ran no paid ads of its own:</b> all of this was paid by other campaigns that chose to use its image. </>}Meta Ad Library, accumulated ranges since Aug 16. Joint-ticket spend belongs to the campaign that paid and the ad may promote several candidacies. Cost per vote = total ÷ the candidacy's votes: a yardstick for comparison, not the effect of the ads.{r.soNome.length ? <> Not in the total: {fmt(r.soNome.length)} ads that mention the name only ({faixa(r.gs)}).</> : null}{" "}</>
          : <>{!proprios && <><b>A candidatura não fez tráfego pago próprio:</b> todo o valor é de outras campanhas que escolheram usar a sua imagem. </>}Biblioteca de Anúncios da Meta, faixas acumuladas desde 16/08. O gasto das dobradas é da campanha que pagou e o anúncio pode promover várias candidaturas. Custo por voto = total ÷ votos da candidatura: régua de comparação, não efeito dos anúncios.{r.soNome.length ? <> Fora do total: {fmt(r.soNome.length)} anúncios que só citam o nome ({faixa(r.gs)}).</> : null}{" "}</>}
        <Link to={`/publicidade?c=${candId}`} className="text-accent">{L("Ver anúncios →", "See ads →")}</Link>
      </p>
    </div>
  );
}

export function Bloco({ rotulo, valor, sub, destaque = false }: { rotulo: string; valor: string; sub: string; destaque?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col rounded-md border px-3 py-2 ${destaque ? "border-accent bg-accent-soft/40" : "border-line bg-panel"}`}>
      <span className="eyebrow">{rotulo}</span>
      <b className="num whitespace-nowrap text-base">{valor}</b>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}
