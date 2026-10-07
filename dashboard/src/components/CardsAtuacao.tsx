import { useMemo } from "react";
import { Link } from "react-router-dom";
import { nossasDaUf, useBairrosDuelo, useBaseCandidatura, useDuelo, type Linha } from "../lib/atuacao";
import type { Base } from "../lib/data";
import { dec, fmt, pct, titulo } from "../lib/format";
import { L } from "../lib/i18n";
import { CARGOS, type Candidatura } from "../lib/types";
import { useUf } from "../lib/uf";

/** Um card por candidatura nossa na UF: o que fazer no 2º turno e onde (bairros da base cruzados com Lula × adversário). */
export function CardsAtuacao() {
  const { uf } = useUf();
  const d = useDuelo();
  const duelo = useBairrosDuelo(d.base.data, d.lula, d.adv, d.votos.data, d.totais.data);
  const base = d.base.data;
  if (!base) return null;
  const cands = nossasDaUf(base, uf);
  if (!cands.length) return null;
  return (
    <section aria-label={L("O que nossas candidaturas podem fazer", "What our candidacies can do")} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-2xl">{L("O que nossas candidaturas podem fazer, e onde", "What our candidacies can do, and where")}</h2>
        <Link to="/esperanca" className="text-sm text-accent">{L("detalhes por bairro em Ainda há esperança →", "neighbourhood detail in Still hope →")}</Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {cands.map((c) => duelo && d.adv
          ? <Card key={c.id} base={base} c={c} bairros={duelo.bairros} nomeAdv={titulo(d.adv.nome)} />
          : <div key={c.id} className="rounded-lg border border-line bg-panel p-4 text-sm text-muted">{d.error ? L("Erro ao carregar o 2º turno.", "Error loading the runoff.") : L("Carregando…", "Loading…")}</div>)}
      </div>
    </section>
  );
}

const lugar = (b: Linha) => `${b.bairro} (${b.cidade})`;

function Card({ base, c, bairros, nomeAdv }: { base: Base; c: Candidatura; bairros: Linha[]; nomeAdv: string }) {
  const { linhas, shareLula, loading } = useBaseCandidatura(base, c, bairros);
  const r = useMemo(() => {
    if (!linhas?.length) return null;
    const votosBase = linhas.reduce((a, b) => a + b.votosC, 0);
    const mobilizar = linhas.filter((b) => b.margem > 0).filter((b) => b.saldo > 0).sort((a, b) => b.score - a.score).slice(0, 4);
    const saldo = linhas.filter((b) => b.margem > 0).reduce((a, b) => a + b.saldo, 0);
    const disputa = linhas.filter((b) => b.margem <= 0 && b.margem > -0.15).sort((a, b) => b.votosC - a.votosC).slice(0, 3);
    const hostil = linhas.filter((b) => b.margem <= -0.15).sort((a, b) => b.votosC - a.votosC).slice(0, 3);
    const cidades = [...new Set(mobilizar.map((b) => b.cidade))];
    return { shareBase: c.votos ? votosBase / c.votos : 0, mobilizar, saldo, disputa, hostil, cidades, n: linhas.length };
  }, [linhas, c]);
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
      <header>
        <h3 className="text-lg font-semibold"><Link className="hover:text-accent" to={`/c/${c.id}`}>{titulo(c.nome)}</Link></h3>
        <div className="text-xs text-muted">{c.partido} · {CARGOS[c.cargo]} · {fmt(c.votos)} {L("votos", "votes")}</div>
      </header>
      {loading ? <p className="text-sm text-muted">{L("Carregando…", "Loading…")}</p> : !r ? <p className="text-sm text-muted">{L("Sem base territorial concentrada para cruzar.", "No concentrated territorial base to cross-reference.")}</p> : (
        <>
          <p className="text-xs text-muted">
            {L(`${pct(shareLula ?? 0, 0)} dos votos da candidatura vieram de bairros onde Lula ficou à frente de ${nomeAdv}. Base forte: ${fmt(r.n)} bairros com 1,2× ou mais a sua média no estado (${pct(r.shareBase, 0)} dos votos).`,
              `${pct(shareLula ?? 0, 0)} of the candidacy's votes came from neighbourhoods where Lula led ${nomeAdv}. Strong base: ${fmt(r.n)} neighbourhoods at 1.2× or more its state average (${pct(r.shareBase, 0)} of its votes).`)}
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {r.mobilizar.length > 0 && (
              <li>
                <b>{L("Puxar comparecimento para Lula", "Drive turnout for Lula")}</b>{" "}
                <span className="text-xs text-muted">({L(`+${fmt(Math.round(r.saldo))} votos líquidos a cada 10% de abstencionistas`, `+${fmt(Math.round(r.saldo))} net votes per 10% of abstainers`)})</span>
                <div>{L("Onde: ", "Where: ")}{r.mobilizar.map(lugar).join(", ")}.</div>
                <div className="text-xs text-muted">{L("Mutirão porta a porta, transporte no dia, plenárias com a militância local.", "Door-to-door, election-day transport, meetings with local activists.")}</div>
              </li>
            )}
            {r.disputa.length > 0 && (
              <li>
                <b>{L("Disputar voto na própria base", "Win votes in its own base")}</b>
                <div>{L("Onde: ", "Where: ")}{r.disputa.map((b) => `${lugar(b)}, ${nomeAdv} +${dec(-b.margem * 100, 0)} ${L("p.p.", "pp")}`).join("; ")}</div>
                <div className="text-xs text-muted">{L("A candidatura tem reconhecimento ali, mas a extrema direita venceu por pouco: conversa de persuasão (custo de vida, emprego, serviços), não só mobilização.", "The candidacy is known there but the far right won narrowly: persuasion (cost of living, jobs, services), not just turnout.")}</div>
              </li>
            )}
            {r.cidades.length > 0 && (
              <li>
                <b>{L("Tráfego pago de comparecimento", "Turnout ads")}</b>
                <div>{L("Segmentar por bairro/CEP em ", "Target by neighbourhood/ZIP in ")}{r.cidades.join(", ")}{L(", com o rosto da candidatura pedindo voto em Lula.", ", with the candidate's face asking for a Lula vote.")}</div>
              </li>
            )}
            {r.hostil.length > 0 && (
              <li className="text-xs text-muted">
                {L("Evitar campanha de comparecimento em ", "Avoid turnout drives in ")}{r.hostil.map(lugar).join(", ")}
                {L(` (base da candidatura, mas ${nomeAdv} venceu por 15 p.p. ou mais: mobilizar ali ajuda o adversário).`, ` (candidacy base, but ${nomeAdv} won by 15+ pp: turnout there helps the opponent).`)}
              </li>
            )}
          </ul>
        </>
      )}
    </article>
  );
}
