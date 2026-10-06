import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MultiView } from "../components/MultiView";
import { CandidatePicker, ErrorBox, Loading, MunicipioSelect, nomeCand } from "../components/ui";
import { useBase } from "../lib/data";
import { titulo } from "../lib/format";
import { source } from "../lib/source";
import type { Candidatura } from "../lib/types";

const usePaineis = () => useQuery({ queryKey: ["paineis"], queryFn: () => source.paineis() });

export function Paineis() {
  const base = useBase();
  const paineis = usePaineis();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [titulo_, setTitulo] = useState("");
  const [sel, setSel] = useState<Candidatura[]>([]);
  const [mun, setMun] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: () => source.salvarPainel({ titulo: titulo_.trim(), candidatura_ids: sel.map((c) => c.id), cd_municipio: mun }),
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ["paineis"] }); navigate(`/paineis/${p.id}`); },
  });
  const apagar = useMutation({
    mutationFn: (id: string) => source.apagarPainel(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["paineis"] }),
  });

  if (base.error) return <ErrorBox error={base.error} />;
  if (!base.data) return <Loading />;
  const b = base.data;
  const podeSalvar = titulo_.trim().length > 0 && sel.length > 0 && !salvar.isPending;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <div className="eyebrow">Painéis personalizados</div>
        <h1 className="display text-3xl">Monte um painel com as candidaturas que quiser</h1>
        <p className="max-w-2xl text-muted">Qualquer candidatura, de qualquer partido e cargo. O painel fica salvo e visível para toda a equipe; só quem criou pode apagá-lo.</p>
      </header>

      <form className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-5"
        onSubmit={(e) => { e.preventDefault(); if (podeSalvar) salvar.mutate(); }}>
        <h2 className="display text-xl">Novo painel</h2>
        <label htmlFor="titulo-painel" className="flex flex-col gap-1 text-sm text-muted">Título
          <input id="titulo-painel" value={titulo_} onChange={(e) => setTitulo(e.target.value)} maxLength={120}
            placeholder="Ex.: Dobradas do PSOL na zona leste" className="rounded-md border border-line bg-bg px-3 py-1.5 text-ink" />
        </label>
        <div className="flex flex-col gap-1 text-sm text-muted">Candidaturas ({sel.length}/12)
          <CandidatePicker id="painel-busca" base={b} onPick={(c) => setSel((s) => (s.some((x) => x.id === c.id) || s.length >= 12 ? s : [...s, c]))} />
        </div>
        {sel.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {sel.map((c) => (
              <li key={c.id} className="flex items-center gap-1 rounded-full border border-line bg-accent-soft px-3 py-1 text-sm">
                {nomeCand(c)} <span className="text-muted">{c.partido}</span>
                <button type="button" aria-label={`Remover ${c.nome}`} className="ml-1 text-muted hover:text-ink"
                  onClick={() => setSel((s) => s.filter((x) => x.id !== c.id))}>×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="max-w-xs"><MunicipioSelect base={b} value={mun} onChange={setMun} id="mun-painel" /></div>
        {salvar.error && <ErrorBox error={salvar.error} />}
        <div><button type="submit" disabled={!podeSalvar}
          className="rounded-md bg-accent px-4 py-2 font-semibold text-panel disabled:opacity-40">Salvar e abrir</button></div>
      </form>

      <section aria-label="Painéis salvos" className="flex flex-col gap-2">
        <h2 className="display text-xl">Painéis salvos</h2>
        {paineis.error && <ErrorBox error={paineis.error} />}
        {paineis.data?.length === 0 && <p className="text-muted">Nenhum painel ainda. Crie o primeiro acima.</p>}
        <ul className="grid gap-2 md:grid-cols-2">
          {paineis.data?.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-panel p-4">
              <Link to={`/paineis/${p.id}`} className="min-w-0">
                <div className="font-semibold hover:underline">{p.titulo}</div>
                <div className="text-sm text-muted">
                  {p.candidatura_ids.map((id) => b.candById.get(id)?.nome).filter(Boolean).join(", ")}
                  {p.cd_municipio ? ` · ${titulo(b.munByCd.get(p.cd_municipio)?.nome ?? "")}` : ""}
                </div>
              </Link>
              <button type="button" className="text-sm text-muted hover:text-danger" onClick={() => apagar.mutate(p.id)}>Apagar</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function PainelView() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const paineis = usePaineis();
  const base = useBase();
  const p = paineis.data?.find((x) => x.id === id);
  if (paineis.error) return <ErrorBox error={paineis.error} />;
  if (!paineis.data || !base.data) return <Loading />;
  if (!p) return <ErrorBox error="Painel não encontrado." />;
  const municipio = sp.get("mun") ?? p.cd_municipio;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Painel personalizado</div>
          <h1 className="display text-3xl">{p.titulo}</h1>
        </div>
        <MunicipioSelect base={base.data} value={municipio} id="mun-pv"
          onChange={(cd) => { const n = new URLSearchParams(sp); if (cd) n.set("mun", cd); else n.delete("mun"); setSp(n, { replace: true }); }} />
      </header>
      <MultiView key={`${p.id}-${municipio}`} ids={p.candidatura_ids} municipio={municipio}
        nomeArquivo={p.titulo.replace(/\W+/g, "_")}
        onMunicipio={(cd) => { const n = new URLSearchParams(sp); n.set("mun", cd); setSp(n, { replace: true }); }} />
    </div>
  );
}
