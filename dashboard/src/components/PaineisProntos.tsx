import { Link } from "react-router-dom";
import { usePaineis } from "../pages/Paineis";
import { useBase } from "../lib/data";
import type { Painel } from "../lib/types";
import { L } from "../lib/i18n";

const ORDEM_GRUPOS = ["PSOL · comparativos", "Candidaturas em destaque"];

export function agruparPaineis(paineis: Painel[]): [string, Painel[]][] {
  const grupos = new Map<string, Painel[]>();
  for (const p of paineis) {
    const g = p.grupo ?? (p.autor ? L("Painéis da equipe", "Team panels") : L("Painéis prontos", "Ready-made panels"));
    grupos.set(g, [...(grupos.get(g) ?? []), p]);
  }
  const peso = (g: string) => (ORDEM_GRUPOS.includes(g) ? ORDEM_GRUPOS.indexOf(g) : g === L("Painéis da equipe", "Team panels") ? 99 : 10);
  return [...grupos.entries()].sort((a, b) => peso(a[0]) - peso(b[0]) || a[0].localeCompare(b[0]));
}

/** Nome do grupo no idioma atual (os grupos vêm dos dados, em português). */
export function rotuloGrupo(g: string): string {
  if (g === "Candidaturas em destaque") return L(g, "Featured candidates");
  if (g === "PSOL · comparativos") return L(g, "PSOL · comparisons");
  return g;
}

/** Painéis prontos (sem autor) em destaque, agrupados. */
export function PaineisProntos() {
  const paineis = usePaineis();
  const base = useBase();
  const nomes = (base.data?.candidaturasDestaque ?? []).map((id) => base.data?.candById.get(id)?.nome).filter(Boolean);
  const rotuloPres = nomes.length
    ? L(`${nomes.join(" e ")} onde o Lula venceu`, `${nomes.join(" and ")} where Lula won`)
    : L("Candidaturas onde o Lula venceu", "Candidates where Lula won");
  const prontos = (paineis.data ?? []).filter((p) => !p.autor);
  if (!prontos.length) return null;
  return (
    <section aria-label={L("Painéis prontos", "Ready-made panels")} className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="display text-xl">{L("Painéis prontos", "Ready-made panels")}</h2>
        <Link to="/paineis" className="text-sm text-accent">{L("Todos os painéis e criar novo →", "All panels and create new →")}</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {agruparPaineis(prontos).map(([grupo, ps]) => (
          <div key={grupo} className="rounded-lg border border-line bg-panel p-4">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{rotuloGrupo(grupo)}</h3>
            <ul className={ps.length > 4 ? "grid gap-x-4 sm:grid-cols-2" : "flex flex-col"}>
              {ps.map((p) => (
                <li key={p.id}>
                  <Link to={`/paineis/${p.id}`} className="flex items-baseline gap-2 border-b border-line py-1.5 hover:text-accent">
                    {p.ordem != null && ps.length > 4 && <span className="num w-5 text-right text-xs text-muted">{p.ordem}</span>}
                    <span className="font-semibold">{p.grupo?.includes("10 cidades") ? p.titulo.replace(/^.+? em /, "") : p.titulo}</span>
                  </Link>
                </li>
              ))}
              {grupo === "Candidaturas em destaque" && (
                <li>
                  <Link to="/presidente" className="flex items-baseline gap-2 border-b border-line py-1.5 hover:text-accent">
                    <span className="font-semibold">{rotuloPres}</span>
                    <span className="text-xs text-muted">{L("Presidente × candidatura", "President × candidate")}</span>
                  </Link>
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
