import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useBase } from "../lib/data";
import { dec, fmt, pct } from "../lib/format";
import { L, locale } from "../lib/i18n";
import { source } from "../lib/source";
import { CARGOS } from "../lib/types";
import { useUf } from "../lib/uf";
import { Bloco } from "./GastoTopo";

/*
 * Fundo eleitoral (FEFC) no topo do painel da candidatura, da prestação de contas do TSE:
 *   recebido  = receitas com fonte Fundo Especial (do partido ou repassadas por outras candidaturas);
 *   por voto  = fundo ÷ votos nominais do 1º turno;
 *   referência = soma do fundo ÷ soma dos votos das candidaturas eleitas ao mesmo cargo na UF (deputados) ou de todas
 *                as candidaturas ao cargo (Governo e Senado, com só 1 ou 2 eleitas).
 * Receitas são declaradas em até 72 h, então o fundo já é número quase fechado; o gasto declarado vai só como nota,
 * porque até a prestação final (3/11; 24/11 para quem foi ao 2º turno) ainda é parcial.
 */
const reais = (x: number, casas = 0) =>
  `R$ ${new Intl.NumberFormat(locale(), { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(x)}`;
const dataBr = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(locale()) : "?");

export function FundoTopo({ candId }: { candId: number }) {
  const { uf } = useUf();
  const base = useBase();
  const q = useQuery({ queryKey: ["fundo", uf], queryFn: () => source.fundo(), staleTime: 30 * 60_000 });
  const cand = base.data?.candById.get(candId);

  const r = useMemo(() => {
    if (!q.data || !base.data || !cand) return null;
    const idx = new Map(q.data.id.map((id, i) => [id, i]));
    const i = idx.get(candId);
    if (i == null) return null;
    const majoritario = cand.cargo === 3 || cand.cargo === 5;
    const grupo = base.data.candidaturas.filter((c) => c.cargo === cand.cargo && c.tipo === "nominal" && idx.has(c.id)
      && (majoritario || c.situacao?.startsWith("Eleito")));
    const soma = grupo.reduce((a, c) => ({ f: a.f + q.data!.fundo[idx.get(c.id)!], v: a.v + c.votos }), { f: 0, v: 0 });
    return {
      fundo: q.data.fundo[i], partidario: q.data.partidario[i], receita: q.data.receita[i], gasto: q.data.gasto[i],
      prestacao: q.data.prestacao[i], dataPrest: q.data.data_prestacao[i], dataTse: q.data.data_tse,
      ref: soma.v ? soma.f / soma.v : null, nRef: grupo.length, majoritario,
    };
  }, [q.data, base.data, cand, candId]);

  if (!r || !cand) return null;
  const votos = cand.votos;
  const porVoto = votos ? r.fundo / votos : null;
  const cargo = CARGOS[cand.cargo]?.toLowerCase() ?? "";
  const refRotulo = r.majoritario
    ? L(`média das ${fmt(r.nRef)} candidaturas a ${cargo} no estado`, `average of the ${fmt(r.nRef)} candidacies for ${cargo} in the state`)
    : L(`média das ${fmt(r.nRef)} eleitas a ${cargo} no estado`, `average of the ${fmt(r.nRef)} elected for ${cargo} in the state`);
  const prest = r.prestacao ? r.prestacao.charAt(0) + r.prestacao.slice(1).toLowerCase() : null;
  const segundoTurno = cand.situacao?.startsWith("2");

  return (
    <div className="flex flex-wrap items-stretch gap-2 text-sm" aria-label={L("Fundo eleitoral", "Electoral fund")}>
      <Bloco rotulo={L("Fundo eleitoral recebido", "Electoral fund received")} valor={reais(r.fundo)}
        sub={r.receita > 0 ? L(`${pct(r.fundo / r.receita, 0)} da receita da campanha (${reais(r.receita)})`, `${pct(r.fundo / r.receita, 0)} of campaign revenue (${reais(r.receita)})`)
          : L("nenhuma receita declarada", "no revenue declared")} />
      <span className="self-center text-muted" aria-hidden>÷</span>
      <Bloco destaque rotulo={L("Fundo eleitoral por voto", "Electoral fund per vote")}
        valor={porVoto != null ? `R$ ${dec(porVoto)}` : "–"}
        sub={L(`${fmt(votos)} votos no 1º turno`, `${fmt(votos)} votes in the 1st round`)} />
      {r.ref != null && (
        <Bloco rotulo={L("Referência", "Benchmark")} valor={`R$ ${dec(r.ref)}`} sub={refRotulo} />
      )}
      <p className="w-full text-xs text-muted">
        {L(<><b>Com base no fundo eleitoral</b> (Fundo Especial de Financiamento de Campanha) declarado ao TSE, que já está praticamente completo: receitas são declaradas em até 72 horas.
          {r.fundo === 0 && <> A candidatura não declarou dinheiro do fundo eleitoral; a campanha foi financiada por outras fontes.</>}
          {r.partidario > 0 && <> Recebeu também {reais(r.partidario)} do fundo partidário (fora desta conta).</>}
          {" "}Não é o custo total da campanha: o gasto declarado até agora é {r.gasto != null ? reais(r.gasto) : "–"}{prest ? ` (${prest}, ${dataBr(r.dataPrest)})` : ""}, e a prestação final vence em {segundoTurno ? "24/11" : "3/11"}.
          {segundoTurno && <> O valor pode incluir recursos do 2º turno; os votos são do 1º.</>}
          {" "}Prestação de contas do TSE, arquivo de {dataBr(r.dataTse)}.</>,
          <><b>Based on the electoral fund</b> (FEFC, public campaign fund) declared to the TSE, which is already nearly complete: revenue must be declared within 72 hours.
          {r.fundo === 0 && <> The candidacy declared no electoral-fund money; the campaign was financed by other sources.</>}
          {r.partidario > 0 && <> It also received {reais(r.partidario)} from the party fund (not counted here).</>}
          {" "}This is not the total campaign cost: spending declared so far is {r.gasto != null ? reais(r.gasto) : "–"}{prest ? ` (${prest}, ${dataBr(r.dataPrest)})` : ""}, and the final report is due {segundoTurno ? "Nov 24" : "Nov 3"}.
          {segundoTurno && <> The amount may include 2nd-round funds; votes are from the 1st round.</>}
          {" "}TSE campaign finance file of {dataBr(r.dataTse)}.</>)}
      </p>
    </div>
  );
}
