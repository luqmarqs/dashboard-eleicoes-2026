import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { agregar, type Base, type PorLocal } from "../lib/data";
import { dec, fmt, pct, titulo } from "../lib/format";
import { L, getLang } from "../lib/i18n";
import { fmtFaixa, porMunicipio, somaFaixas, custoPorMil, fmtCusto } from "../lib/meta";
import { useMetaAnuncios, useMetaResumo } from "../lib/metaHooks";
import { source, type MetaAnuncio } from "../lib/source";
import { EIXOS, contarTemas, rotuloDe } from "../lib/temas";
import { CARGOS, type Candidatura } from "../lib/types";
import { emUf, useUf } from "../lib/uf";
import { spearman } from "./AnunciosVotos";
import { useHistorico } from "./Historico";
import { situacaoTexto } from "./ui";

/*
 * Análise breve e objetiva das candidaturas prioritárias (destaques da UF), gerada a partir dos dados:
 * resultado, comparação com 2022, concentração territorial, tráfego pago e dobradas. Cada ponto traz um número;
 * nada de causalidade (anúncios e votos são cruzados de forma descritiva).
 */
const en = () => getLang() === "en";
const ord = (n: number) => (en() ? `#${n}` : `${n}º`);

export function AnaliseCandidatura({ base, cand, dados }: { base: Base; cand: Candidatura; dados: PorLocal }) {
  const { uf, info } = useUf();
  const hist = useHistorico(cand.id);
  const resumo = useMetaResumo();
  const item = resumo.data?.candidaturas.find((c) => c.candidatura_id === cand.id);
  const proprios = !!item && item.anuncios > 0;
  const ads = useMetaAnuncios(cand.id, item?.ultima_coleta, proprios);
  const dob = useQuery({ queryKey: ["meta-dobradas", uf, cand.id], queryFn: () => source.metaDobradas(cand.id), enabled: !!item, staleTime: 5 * 60_000 });

  const pontos = useMemo(() => {
    const out: ReactNode[] = [];
    const nome = titulo(cand.nome);
    // 1. resultado
    const doCargo = base.candidaturas.filter((c) => c.cargo === cand.cargo && c.tipo === "nominal").sort((a, b) => b.votos - a.votos);
    const posCargo = doCargo.findIndex((c) => c.id === cand.id) + 1;
    const doPartido = doCargo.filter((c) => c.partido === cand.partido);
    const posPartido = doPartido.findIndex((c) => c.id === cand.id) + 1;
    const validos = base.candidaturas.filter((c) => c.cargo === cand.cargo && c.destinacao?.startsWith("Válido")).reduce((s, c) => s + c.votos, 0);
    out.push(en()
      ? <><b>Result:</b> {fmt(cand.votos)} votes ({pct(cand.votos / validos)} of valid votes), {ord(posCargo)} among {fmt(doCargo.length)} {CARGOS[cand.cargo]} candidacies {emUf(info).replace(info.nome, info.sigla)} and {ord(posPartido)} in {cand.partido}{cand.situacao ? <> — {situacaoTexto(cand.situacao)}</> : null}.</>
      : <><b>Resultado:</b> {fmt(cand.votos)} votos ({pct(cand.votos / validos)} dos válidos), {ord(posCargo)} entre {fmt(doCargo.length)} candidaturas a {CARGOS[cand.cargo]} {emUf(info).replace(info.nome, info.sigla)} e {ord(posPartido)} no {cand.partido}{cand.situacao ? <> — {situacaoTexto(cand.situacao)}</> : null}.</>);

    // 2. 2022
    const r22 = hist.data?.resumo[0];
    const municipios = agregar(base, dados, "municipio");
    if (r22 && hist.data) {
      const v22 = new Map<string, number>();
      hist.data.chave.forEach((k, i) => { if (hist.data!.nivel[i] === "municipio") v22.set(k, hist.data!.votos[i]); });
      const difs = municipios.map((m) => ({ nome: m.nome, d: m.votos - (v22.get(m.key) ?? 0) })).sort((a, b) => b.d - a.d);
      const ganho = difs[0], perda = difs[difs.length - 1];
      const d = cand.votos - r22.votos_total;
      out.push(en()
        ? <><b>Versus 2022</b> ({CARGOS[r22.cd_cargo]}, {fmt(r22.votos_total)} votes): {d >= 0 ? "+" : ""}{fmt(d)} votes ({d >= 0 ? "+" : ""}{pct(d / r22.votos_total, 0)}). Biggest gain in {titulo(ganho.nome)} ({ganho.d >= 0 ? "+" : ""}{fmt(ganho.d)}){perda && perda.d < 0 ? <>; biggest loss in {titulo(perda.nome)} ({fmt(perda.d)})</> : null}.</>
        : <><b>Comparado a 2022</b> ({CARGOS[r22.cd_cargo]}, {fmt(r22.votos_total)} votos): {d >= 0 ? "+" : ""}{fmt(d)} votos ({d >= 0 ? "+" : ""}{pct(d / r22.votos_total, 0)}). Maior ganho em {titulo(ganho.nome)} ({ganho.d >= 0 ? "+" : ""}{fmt(ganho.d)}){perda && perda.d < 0 ? <>; maior perda em {titulo(perda.nome)} ({fmt(perda.d)})</> : null}.</>);
    }

    // 3. concentração territorial
    const total = municipios.reduce((s, m) => s + m.votos, 0) || 1;
    const capital = municipios.find((m) => m.key === info.capital);
    const top5 = municipios.slice(0, 5);
    const comVoto = municipios.filter((m) => m.votos > 0).length;
    const metade = (() => { let s = 0; for (let i = 0; i < municipios.length; i++) { s += municipios[i].votos; if (s >= total / 2) return i + 1; } return municipios.length; })();
    out.push(en()
      ? <><b>Territory:</b> {capital ? <>the capital gave {pct(capital.votos / total, 0)} of the votes; </> : null}the top 5 cities ({top5.map((m) => titulo(m.nome)).join(", ")}) gave {pct(top5.reduce((s, m) => s + m.votos, 0) / total, 0)}; half of the votes came from {fmt(metade)} {metade === 1 ? "city" : "cities"}, out of {fmt(comVoto)} with any vote.</>
      : <><b>Território:</b> {capital ? <>a capital deu {pct(capital.votos / total, 0)} dos votos; </> : null}as 5 maiores cidades ({top5.map((m) => titulo(m.nome)).join(", ")}) deram {pct(top5.reduce((s, m) => s + m.votos, 0) / total, 0)}; metade dos votos veio de {fmt(metade)} {metade === 1 ? "cidade" : "cidades"}, de {fmt(comVoto)} com algum voto.</>);

    // 4. tráfego pago (próprio; sem próprio, dobradas)
    const recebe = (dob.data ?? []).filter((m) => m.papel === "recebe");
    const lista: MetaAnuncio[] = proprios ? ads.data ?? [] : [...new Map(recebe.map((m) => [m.ad.id, m.ad])).values()];
    if (lista.length) {
      const g = somaFaixas(lista, "gasto").get("BRL");
      const t = contarTemas(lista);
      const temaTop = EIXOS[0].temas.map((x) => ({ x, n: t.porTema.get(x.id)?.criativos ?? 0 })).sort((a, b) => b.n - a.n)[0];
      const mun = porMunicipio(lista);
      const vm = new Map(municipios.map((m) => [m.key, m]));
      const pares = municipios.filter((m) => m.validos > 0).map((m) => { const x = mun.get(m.key); return [x ? x.inclui.size + x.bairro.size : 0, m.pct] as const; });
      const rho = spearman(pares.map((p) => p[0]), pares.map((p) => p[1]));
      const cidades = [...mun.values()].filter((x) => x.inclui.size + x.bairro.size > 0 && vm.has(x.cd)).length;
      const votosNasSeg = [...mun.values()].filter((x) => x.inclui.size + x.bairro.size > 0).reduce((s, x) => s + (vm.get(x.cd)?.votos ?? 0), 0);
      const forca = !Number.isFinite(rho) ? null : Math.abs(rho) >= 0.5 ? L("forte", "strong") : Math.abs(rho) >= 0.3 ? L("moderada", "moderate") : L("fraca", "weak");
      out.push(en()
        ? <><b>Paid ads{proprios ? "" : " (by allies)"}:</b> {fmt(lista.length)} ads ({fmt(t.criativos)} distinct creatives){g ? <>, declared spend {fmtFaixa(g.min, g.max, "R$ ")}</> : null}{custoPorMil(lista) ? <>, {fmtCusto(custoPorMil(lista))} per 1,000 reached</> : null}{temaTop?.n ? <>; top policy theme: {rotuloDe(temaTop.x)} ({pct(temaTop.n / t.criativos, 0)} of creatives)</> : null}. {fmt(cidades)} cities targeted by name, holding {pct(votosNasSeg / total, 0)} of the votes{forca ? <>; {forca} correlation between ads per city and vote share ({dec(rho, 2)})</> : null}.</>
        : <><b>Tráfego pago{proprios ? "" : " (de aliados)"}:</b> {fmt(lista.length)} anúncios ({fmt(t.criativos)} criativos distintos){g ? <>, gasto declarado {fmtFaixa(g.min, g.max, "R$ ")}</> : null}{custoPorMil(lista) ? <>, {fmtCusto(custoPorMil(lista))} por mil alcançados</> : null}{temaTop?.n ? <>; tema de política principal: {rotuloDe(temaTop.x)} ({pct(temaTop.n / t.criativos, 0)} dos criativos)</> : null}. {fmt(cidades)} cidades segmentadas pelo nome, com {pct(votosNasSeg / total, 0)} dos votos{forca ? <>; correlação {forca} entre anúncios por cidade e % dos válidos ({dec(rho, 2)})</> : null}.</>);
    }

    // 5. dobradas recebidas
    if (recebe.length) {
      const por = new Map<number, Set<string>>();
      for (const m of recebe) if (m.outra != null && m.confirmada) por.set(m.outra, (por.get(m.outra) ?? new Set()).add(m.ad.id));
      const top = [...por.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 3)
        .map(([id, s]) => ({ c: base.candById.get(id), n: s.size })).filter((x) => x.c);
      const total = new Set(recebe.map((m) => m.ad.id)).size;
      if (top.length) out.push(en()
        ? <><b>Joint tickets:</b> {proprios ? <>{fmt(total)} ads from other campaigns mention {nome}; </> : null}confirmed (name + number + campaign funder) mostly by {top.map((x) => `${titulo(x.c!.nome)} (${x.n})`).join(", ")}.</>
        : <><b>Dobradas:</b> {proprios ? <>{fmt(total)} anúncios de outras campanhas citam {nome}; </> : null}confirmadas (nome + número + CNPJ de campanha) principalmente por {top.map((x) => `${titulo(x.c!.nome)} (${x.n})`).join(", ")}.</>);
    }
    return out;
  }, [base, cand, dados, hist.data, ads.data, dob.data, proprios, info]);

  return (
    <section aria-label={L("Análise", "Analysis")} className="rounded-lg border border-accent/40 bg-accent-soft/30 p-4">
      <h2 className="eyebrow mb-2 text-accent">{L("Análise", "Analysis")}</h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
        {pontos.map((p, i) => <li key={i}>{p}</li>)}
      </ul>
      <p className="mt-2 text-xs text-muted">
        {L("Gerada a partir dos dados do TSE e da Biblioteca de Anúncios da Meta. Cruzamentos descritivos: não medem efeito dos anúncios.",
          "Generated from TSE and Meta Ad Library data. Descriptive cross-tabulations: they do not measure ad effects.")}
      </p>
    </section>
  );
}

