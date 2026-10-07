import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PaineisProntos } from "../components/PaineisProntos";
import { CandidatePicker, ErrorBox, Loading, SituacaoBadge, nomeCand } from "../components/ui";
import { useBase, type Base } from "../lib/data";
import { source } from "../lib/source";
import { deUf, emUf, useUf } from "../lib/uf";
import { dec, fmt, titulo } from "../lib/format";
import { L } from "../lib/i18n";
import { CARGOS, type Candidatura } from "../lib/types";

function topPartido(base: Base, partido: string, cargo: number, n: number) {
  return base.candidaturas
    .filter((c) => c.partido === partido && c.cargo === cargo && c.tipo === "nominal")
    .sort((a, b) => b.votos - a.votos)
    .slice(0, n);
}

export function Overview() {
  const base = useBase();
  const navigate = useNavigate();
  const { info } = useUf();
  const b = base.data;
  const partido = b?.partidosDestaque[0]?.sigla ?? "PSOL";
  const resumo = useMemo(() => {
    if (!b) return [];
    return [6, 7].map((cargo) => {
      const todos = b.candidaturas.filter((c) => c.cargo === cargo);
      const doPartido = todos.filter((c) => c.partido === partido);
      const votos = doPartido.reduce((a, c) => a + c.votos, 0);
      const validos = todos.filter((c) => c.destinacao?.startsWith("Válido")).reduce((a, c) => a + c.votos, 0);
      const legenda = doPartido.filter((c) => c.tipo === "legenda").reduce((a, c) => a + c.votos, 0);
      return { cargo, votos, validos, legenda, top: topPartido(b, partido, cargo, 10) };
    });
  }, [b, partido]);

  if (base.error) return <ErrorBox error={base.error} />;
  if (!b) return <Loading />;
  const destaques = b.candidaturasDestaque.map((id) => b.candById.get(id)).filter(Boolean) as Candidatura[];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="eyebrow">{L(`Estado ${deUf(info)} · 1º turno · 4 de outubro de 2026`, `State ${deUf(info)} · 1st round · October 4, 2026`)}</div>
        <h1 className="display text-4xl">{partido} {emUf(info)}</h1>
      </header>

      <section aria-label={L("Candidaturas em destaque", "Featured candidacies")} className="grid gap-4 md:grid-cols-2">
        {destaques.map((c) => (
          <Link key={c.id} to={`/c/${c.id}`} className="rounded-lg border border-line bg-panel p-5 hover:border-accent">
            <div className="eyebrow">{CARGOS[c.cargo]} · {c.partido}</div>
            <div className="display mt-1 text-2xl">{nomeCand(c)}<SituacaoBadge c={c} /></div>
            <div className="mt-3 flex items-baseline gap-2">
              <b className="display num text-3xl">{fmt(c.votos)}</b>
              <span className="text-muted">{L("votos no estado", "votes in the state")}</span>
            </div>
            <div className="mt-3 text-sm text-accent">{L("Abrir painel →", "Open panel →")}</div>
          </Link>
        ))}
      </section>

      <Dobradas base={b} pares={info.dobradas ?? []} />

      {info.sigla === "MG" && <CardDigital />}

      <Senado base={b} destaques={destaques} />

      <PaineisProntos />

      <section aria-label={L("Buscar candidatura", "Search candidacy")} className="flex flex-col gap-2">
        <h2 className="display text-xl">{L("Qualquer candidatura", "Any candidacy")}</h2>
        <div className="max-w-xl">
          <CandidatePicker base={b} onPick={(c) => navigate(`/c/${c.id}`)} placeholder={L("Abrir o painel de qualquer candidatura (todos os partidos)…", "Open the panel of any candidacy (all parties)…")} />
        </div>
      </section>


      <section aria-label={L(`Resumo do ${partido}`, `${partido} summary`)} className="grid gap-6 lg:grid-cols-2">
        {resumo.map((r) => (
          <div key={r.cargo} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="display text-xl">{CARGOS[r.cargo]}</h2>
              <Link className="text-sm text-accent" to={`/comparativo?partido=${partido}&cargo=${r.cargo}`}>{L("Comparativo no mapa →", "Compare on the map →")}</Link>
            </div>
            <div className="flex flex-wrap gap-x-6 text-sm text-muted">
              <span><b className="num text-ink">{fmt(r.votos)}</b> {L(`votos do ${partido} (nominal + legenda)`, `${partido} votes (candidate + party-list)`)}</span>
              <span><b className="num text-ink">{r.validos ? dec((100 * r.votos) / r.validos, 2) : "–"}%</b> {L("dos válidos", "of valid votes")}</span>
              <span><b className="num text-ink">{fmt(r.legenda)}</b> {L("na legenda", "party-list votes")}</span>
            </div>
            <ol className="rounded-lg border border-line bg-panel">
              {r.top.map((c, i) => (
                <li key={c.id}>
                  <Link to={`/c/${c.id}`} className="grid grid-cols-[24px_1fr_auto] items-baseline gap-2 border-b border-line px-3 py-1.5 last:border-0 hover:bg-accent-soft">
                    <span className="num text-right text-xs text-muted">{i + 1}</span>
                    <span className="font-semibold">{nomeCand(c)}<SituacaoBadge c={c} /></span>
                    <span className="num text-sm">{fmt(c.votos)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>
    </div>
  );
}

/** Resultado do Senado no estado; cada linha abre a análise completa do Senado daquela candidatura. */
function Senado({ base, destaques }: { base: Base; destaques: Candidatura[] }) {
  const sen = useMemo(
    () => base.candidaturas.filter((c) => c.cargo === 5 && c.tipo === "nominal").sort((a, b) => b.votos - a.votos),
    [base],
  );
  if (!sen.length) return null;
  const validos = base.candidaturas.filter((c) => c.cargo === 5 && c.destinacao?.startsWith("Válido")).reduce((a, c) => a + c.votos, 0)
    || sen.reduce((a, c) => a + c.votos, 0);
  // em destaque: candidatura ao Senado entre os destaques da UF e as do campo (PSOL, PT, PCdoB, REDE, PSB)
  const campo = new Set([...base.partidosDestaque.map((p) => p.sigla), "PSOL", "PT", "PCdoB", "REDE", "PSB"]);
  const focos = sen.filter((c) => destaques.some((d) => d.id === c.id) || (c.partido && campo.has(c.partido)));
  const max = sen[0].votos || 1;
  return (
    <section aria-label={L("Senado", "Senate")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-2xl">{L("Senado", "Senate")}</h2>
        <div className="flex flex-wrap gap-2">
          {focos.map((c) => (
            <Link key={c.id} to={`/c/${c.id}`}
              className="rounded-md border border-accent px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft">
              {L("Análise completa", "Full analysis")} · {titulo(c.nome)} ({c.partido}) →
            </Link>
          ))}
        </div>
      </div>
      <ol className="rounded-lg border border-line bg-panel">
        {sen.map((c, i) => (i >= 10 && !focos.includes(c) ? null : (
          <li key={c.id}>
            <Link to={`/c/${c.id}`}
              className={`grid grid-cols-[24px_minmax(0,1fr)_minmax(60px,180px)_auto_auto] items-center gap-3 border-b border-line px-3 py-1.5 last:border-0 hover:bg-accent-soft ${focos.includes(c) ? "bg-accent-soft" : ""}`}>
              <span className="num text-right text-xs text-muted">{i + 1}</span>
              <span className="truncate"><b>{nomeCand(c)}</b> <span className="text-sm text-muted">{c.partido}</span><SituacaoBadge c={c} compacto /></span>
              <span className="h-2 rounded-sm bg-accent/70" style={{ width: `${(100 * c.votos) / max}%` }} aria-hidden />
              <span className="num text-right text-sm">{fmt(c.votos)}</span>
              <span className="num w-16 text-right text-sm text-muted">{validos ? dec((100 * c.votos) / validos, 2) : "–"}%</span>
            </Link>
          </li>
        )))}
      </ol>
      <p className="text-xs text-muted">{sen.length > 10 ? L(`Os 10 mais votados de ${sen.length}. `, `Top 10 of ${sen.length}. `) : ""}{L("Cada eleitor votou em 2 nomes: as porcentagens dos válidos somam 200%. Clique numa candidatura para ver a análise do Senado do ponto de vista dela.", "Each voter chose 2 names: the % of valid votes add up to 200%. Click a candidacy to see the Senate analysis from its point of view.")}</p>
    </section>
  );
}

/** Dobradas fixas da UF (federal × estadual), em cards que abrem a página Dobrada já preenchida. */
function Dobradas({ base, pares }: { base: Base; pares: [number, number][] }) {
  const cards = pares
    .map(([a, b]) => [base.candById.get(a), base.candById.get(b)] as const)
    .filter((p): p is readonly [Candidatura, Candidatura] => !!p[0] && !!p[1]);
  if (!cards.length) return null;
  return (
    <section aria-label={L("Dobradas", "Joint tickets")} className="grid gap-4 md:grid-cols-2">
      {cards.map(([a, b]) => (
        <Link key={`${a.id}-${b.id}`} to={`/dobrada?a=${a.id}&b=${b.id}`}
          className="rounded-lg border border-line bg-panel p-5 hover:border-accent">
          <div className="eyebrow">{L("Dobrada", "Joint ticket")} · {CARGOS[a.cargo]} × {CARGOS[b.cargo]}</div>
          <div className="display mt-1 text-2xl">{titulo(a.nome)} × {titulo(b.nome)}</div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
            {[a, b].map((c) => (
              <span key={c.id}><b className="display num text-xl text-ink">{fmt(c.votos)}</b> {titulo(c.nome)} ({c.numero})</span>
            ))}
          </div>
          <div className="mt-3 text-sm text-accent">{L("Ver no mapa onde as candidaturas são fortes juntas →", "See on the map where the candidates are strong together →")}</div>
        </Link>
      ))}
    </section>
  );
}

/** Card do painel "Evolução digital e votação" (só MG). */
function CardDigital() {
  const d = useQuery({ queryKey: ["digital", "MG"], queryFn: () => source.digital(), staleTime: 5 * 60_000 });
  const n = d.data ? new Set(d.data.perfis.map((p) => p.candidatura_id).filter(Boolean)).size : null;
  if (d.data && !n) return null;
  return (
    <Link to="/digital-mg" className="block rounded-lg border border-line bg-panel p-5 hover:border-accent"
      aria-label={L("Abrir o painel Evolução digital e votação", "Open the Digital growth and votes panel")}>
      <div className="eyebrow">{L("Redes sociais × urnas · Deputado Estadual", "Social media × ballots · State Deputy")}</div>
      <div className="display mt-1 text-2xl">{L("Evolução digital e votação", "Digital growth and votes")}</div>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        {L(
          `${n != null ? `${n} candidaturas acompanhadas desde setembro` : "Candidaturas acompanhadas desde setembro"}: seguidores no Instagram e no X ao longo da campanha e no snapshot atual, postagens no Instagram e a votação de cada uma no 1º turno.`,
          `${n != null ? `${n} candidates tracked since September` : "Candidates tracked since September"}: Instagram and X followers throughout the campaign and in the current snapshot, Instagram posts and each one's votes in the 1st round.`,
        )}
      </p>
      <div className="mt-3 text-sm text-accent">{L("Abrir painel →", "Open panel →")}</div>
    </Link>
  );
}
