import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { source } from "../lib/source";
import { MultiView } from "../components/MultiView";
import { ErrorBox, Loading, MunicipioSelect } from "../components/ui";
import { useBase, useDadosRegra } from "../lib/data";
import { titulo } from "../lib/format";
import { CARGOS } from "../lib/types";

export function Comparativo() {
  const [sp, setSp] = useSearchParams();
  const base = useBase();
  const partidoPadrao = base.data?.partidosDestaque[0]?.sigla ?? "PSOL";
  const partido = sp.get("partido") ?? partidoPadrao;
  const cargo = Number(sp.get("cargo") ?? 7);
  const top = Number(sp.get("top") ?? 10);
  const municipio = sp.get("mun");
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v == null) n.delete(k); else n.set(k, v);
    setSp(n, { replace: true });
  };
  const topQ = useDadosRegra(partido, cargo, municipio, top);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [ambos, setAmbos] = useState(true);
  const nomeMun = municipio ? titulo(base.data?.munByCd.get(municipio)?.nome ?? "") : null;
  const salvar = useMutation({
    mutationFn: () => {
      const cargos = ambos && (cargo === 6 || cargo === 7) ? [6, 7] : [cargo];
      const sufixo = cargos.length > 1 ? " (federal e estadual)" : ` (${CARGOS[cargo]})`;
      return source.salvarPainel({
        titulo: `${partido}${nomeMun ? ` em ${nomeMun}` : ""} · ${top} mais votados${sufixo}`,
        candidatura_ids: [], regra: { partido, cargos, top }, cd_municipio: municipio,
      });
    },
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ["paineis"] }); navigate(`/paineis/${p.id}`); },
  });
  const partidos = useMemo(() => {
    if (!base.data) return [];
    const destaque = base.data.partidosDestaque.map((p) => p.sigla);
    const todos = [...new Set(base.data.candidaturas.map((c) => c.partido).filter(Boolean) as string[])].sort();
    return [...destaque, ...todos.filter((p) => !destaque.includes(p))];
  }, [base.data]);

  if (base.error) return <ErrorBox error={base.error} />;
  if (!base.data) return <Loading />;
  const ids = topQ.data?.top.map((t) => t.candidatura_id) ?? [];

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="eyebrow">Comparativo</div>
        <h1 className="display text-3xl">
          {top} mais votados do {partido} para {CARGOS[cargo]} {municipio ? `em ${titulo(base.data.munByCd.get(municipio)?.nome ?? "")}` : "no estado"}
        </h1>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="partido" className="flex flex-col gap-1 text-sm text-muted">Partido
          <select id="partido" value={partido} onChange={(e) => set("partido", e.target.value)}
            className="rounded-md border border-line bg-panel px-3 py-1.5 text-ink">
            {partidos.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label htmlFor="cargo" className="flex flex-col gap-1 text-sm text-muted">Cargo
          <select id="cargo" value={cargo} onChange={(e) => set("cargo", e.target.value)}
            className="rounded-md border border-line bg-panel px-3 py-1.5 text-ink">
            {[6, 7, 5, 3, 1].map((c) => <option key={c} value={c}>{CARGOS[c]}</option>)}
          </select>
        </label>
        <label htmlFor="top" className="flex flex-col gap-1 text-sm text-muted">Quantas
          <select id="top" value={top} onChange={(e) => set("top", e.target.value)}
            className="rounded-md border border-line bg-panel px-3 py-1.5 text-ink">
            {[5, 10, 15, 20].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <MunicipioSelect base={base.data} value={municipio} onChange={(cd) => set("mun", cd)} id="mun-comp" />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {(cargo === 6 || cargo === 7) && (
            <label htmlFor="ambos" className="flex items-center gap-1.5 text-sm">
              <input id="ambos" type="checkbox" checked={ambos} onChange={(e) => setAmbos(e.target.checked)} />
              federal e estadual
            </label>
          )}
          <button type="button" onClick={() => salvar.mutate()} disabled={salvar.isPending}
            className="rounded-md bg-accent px-4 py-2 font-semibold text-panel disabled:opacity-50">
            {salvar.isPending ? "Salvando…" : "Salvar como painel"}
          </button>
        </div>
      </div>
      {salvar.error && <ErrorBox error={salvar.error} />}
      {topQ.error && <ErrorBox error={topQ.error} />}
      {topQ.isLoading && <Loading texto="Buscando as candidaturas mais votadas…" />}
      {topQ.data && ids.length === 0 && <p className="text-muted">Nenhuma candidatura com voto neste recorte.</p>}
      {ids.length > 0 && (
        <MultiView key={`${partido}-${cargo}-${municipio}-${top}`} ids={ids} municipio={municipio}
          nomeArquivo={`${partido}_${cargo}_top${top}${municipio ? `_${municipio}` : ""}`}
          onMunicipio={(cd) => set("mun", cd)} />
      )}
    </div>
  );
}
