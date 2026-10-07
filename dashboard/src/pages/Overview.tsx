import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PaineisProntos } from "../components/PaineisProntos";
import { CandidatePicker, ErrorBox, Loading, SituacaoBadge, nomeCand } from "../components/ui";
import { useBase, type Base } from "../lib/data";
import { useUf } from "../lib/uf";
import { fmt, titulo } from "../lib/format";
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
        <div className="eyebrow">Estado de {info.nome} · 1º turno · 4 de outubro de 2026</div>
        <h1 className="display text-4xl">{partido} em {info.nome}</h1>
      </header>

      <section aria-label="Candidaturas em destaque" className="grid gap-4 md:grid-cols-2">
        {destaques.map((c) => (
          <Link key={c.id} to={`/c/${c.id}`} className="rounded-lg border border-line bg-panel p-5 hover:border-accent">
            <div className="eyebrow">{CARGOS[c.cargo]} · {c.partido}</div>
            <div className="display mt-1 text-2xl">{nomeCand(c)}<SituacaoBadge c={c} /></div>
            <div className="mt-3 flex items-baseline gap-2">
              <b className="display num text-3xl">{fmt(c.votos)}</b>
              <span className="text-muted">votos no estado</span>
            </div>
            <div className="mt-3 text-sm text-accent">Abrir painel →</div>
          </Link>
        ))}
      </section>

      <Senado base={b} destaques={destaques} />

      <PaineisProntos />

      <section aria-label="Buscar candidatura" className="flex flex-col gap-2">
        <h2 className="display text-xl">Qualquer candidatura</h2>
        <div className="max-w-xl">
          <CandidatePicker base={b} onPick={(c) => navigate(`/c/${c.id}`)} placeholder="Abrir o painel de qualquer candidatura (todos os partidos)…" />
        </div>
      </section>


      <section aria-label={`Resumo do ${partido}`} className="grid gap-6 lg:grid-cols-2">
        {resumo.map((r) => (
          <div key={r.cargo} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="display text-xl">{CARGOS[r.cargo]}</h2>
              <Link className="text-sm text-accent" to={`/comparativo?partido=${partido}&cargo=${r.cargo}`}>Comparativo no mapa →</Link>
            </div>
            <div className="flex flex-wrap gap-x-6 text-sm text-muted">
              <span><b className="num text-ink">{fmt(r.votos)}</b> votos do {partido} (nominal + legenda)</span>
              <span><b className="num text-ink">{r.validos ? ((100 * r.votos) / r.validos).toFixed(2).replace(".", ",") : "–"}%</b> dos válidos</span>
              <span><b className="num text-ink">{fmt(r.legenda)}</b> na legenda</span>
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
    <section aria-label="Senado" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="display text-2xl">Senado</h2>
        <div className="flex flex-wrap gap-2">
          {focos.map((c) => (
            <Link key={c.id} to={`/c/${c.id}`}
              className="rounded-md border border-accent px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft">
              Análise completa · {titulo(c.nome)} ({c.partido}) →
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
              <span className="num w-16 text-right text-sm text-muted">{validos ? ((100 * c.votos) / validos).toFixed(2).replace(".", ",") : "–"}%</span>
            </Link>
          </li>
        )))}
      </ol>
      <p className="text-xs text-muted">{sen.length > 10 ? `Os 10 mais votados de ${sen.length}. ` : ""}Cada eleitor votou em 2 nomes: as porcentagens dos válidos somam 200%. Clique numa candidatura para ver a análise do Senado do ponto de vista dela.</p>
    </section>
  );
}
