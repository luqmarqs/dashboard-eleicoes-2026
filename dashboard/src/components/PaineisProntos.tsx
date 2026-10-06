import { Link } from "react-router-dom";
import { usePaineis } from "../pages/Paineis";
import { useBase } from "../lib/data";
import type { Painel } from "../lib/types";

const ORDEM_GRUPOS = ["PSOL · comparativos", "Candidaturas em destaque"];

export function agruparPaineis(paineis: Painel[]): [string, Painel[]][] {
  const grupos = new Map<string, Painel[]>();
  for (const p of paineis) {
    const g = p.grupo ?? (p.autor ? "Painéis da equipe" : "Painéis prontos");
    grupos.set(g, [...(grupos.get(g) ?? []), p]);
  }
  const peso = (g: string) => (ORDEM_GRUPOS.includes(g) ? ORDEM_GRUPOS.indexOf(g) : g === "Painéis da equipe" ? 99 : 10);
  return [...grupos.entries()].sort((a, b) => peso(a[0]) - peso(b[0]) || a[0].localeCompare(b[0]));
}

/** Painéis prontos (sem autor) em destaque, agrupados. */
export function PaineisProntos() {
  const paineis = usePaineis();
  const base = useBase();
  const nomes = (base.data?.candidaturasDestaque ?? []).map((id) => base.data?.candById.get(id)?.nome).filter(Boolean);
  const rotuloPres = nomes.length ? `${nomes.join(" e ")} onde o Lula venceu →` : "Candidaturas onde o Lula venceu →";
  const prontos = (paineis.data ?? []).filter((p) => !p.autor);
  if (!prontos.length) return null;
  return (
    <section aria-label="Painéis prontos" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="display text-xl">Painéis prontos</h2>
        <Link to="/paineis" className="text-sm text-accent">Todos os painéis e criar novo →</Link>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/presidente" className="rounded-md border border-accent px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent-soft">
          {rotuloPres}
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {agruparPaineis(prontos).map(([grupo, ps]) => (
          <div key={grupo} className="rounded-lg border border-line bg-panel p-4">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{grupo}</h3>
            <ul className={ps.length > 4 ? "grid gap-x-4 sm:grid-cols-2" : "flex flex-col"}>
              {ps.map((p) => (
                <li key={p.id}>
                  <Link to={`/paineis/${p.id}`} className="flex items-baseline gap-2 border-b border-line py-1.5 hover:text-accent">
                    {p.ordem != null && ps.length > 4 && <span className="num w-5 text-right text-xs text-muted">{p.ordem}</span>}
                    <span className="font-semibold">{p.grupo?.includes("10 cidades") ? p.titulo.replace(/^.+? em /, "") : p.titulo}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
