import { useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MapView, type Metrica, type Modo } from "../components/MapView";
import { Rankings, TopLista } from "../components/Rankings";
import { CandidatePicker, ErrorBox, Loading, MapControls, MunicipioSelect, SituacaoBadge, Stat, nomeCand } from "../components/ui";
import { agregar, porLocal, useBase, useTotais, useVotos } from "../lib/data";
import { fmt, pct, titulo } from "../lib/format";
import { CARGOS } from "../lib/types";

export function useMapParams(defaultModo: Modo = "escolas") {
  const [sp, setSp] = useSearchParams();
  const municipio = sp.get("mun");
  const modo = (sp.get("modo") as Modo) ?? defaultModo;
  const metrica = (sp.get("metrica") as Metrica) ?? "pct";
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v == null) next.delete(k); else next.set(k, v);
    if (k === "mun") {
      // ao trocar de escala, troca para o modo que faz sentido
      const m = next.get("modo");
      if (v && m === "municipios") next.set("modo", "escolas");
      if (!v && m === "territorios") next.set("modo", "municipios");
    }
    setSp(next, { replace: true });
  };
  return { municipio, modo, metrica, set };
}

export function CandidatePanel() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { municipio, modo, metrica, set } = useMapParams();
  const base = useBase();
  const cand = base.data?.candById.get(Number(id));
  const votos = useVotos(cand ? [cand.id] : [], null);
  const totais = useTotais(cand?.cargo, null);

  const dados = useMemo(
    () => (base.data && votos.data && totais.data && cand ? porLocal(base.data, votos.data[cand.id], totais.data) : undefined),
    [base.data, votos.data, totais.data, cand],
  );
  const nivelLista = municipio ? "bairro" : "municipio";
  const lista = useMemo(
    () => (base.data && dados ? agregar(base.data, dados, nivelLista, municipio) : []),
    [base.data, dados, nivelLista, municipio],
  );

  if (base.error) return <ErrorBox error={base.error} />;
  if (!base.data) return <Loading />;
  if (!cand) return <ErrorBox error={`Candidatura ${id} não encontrada.`} />;
  const b = base.data;
  const escopo = municipio ? lista.reduce((a, l) => ({ v: a.v + l.votos, val: a.val + l.validos }), { v: 0, val: 0 }) : null;
  const total = escopo ? escopo.v : dados?.total ?? 0;
  const validos = escopo ? escopo.val : dados?.totalValidos ?? 0;
  const comVoto = lista.filter((l) => l.votos > 0).length;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">{CARGOS[cand.cargo]} · {cand.partido} · São Paulo · 1º turno 2026</div>
          <h1 className="display text-3xl md:text-4xl">{nomeCand(cand)}<SituacaoBadge c={cand} /></h1>
          {cand.nomeCompleto && <p className="text-muted">{cand.nomeCompleto}{cand.situacao ? ` · ${cand.situacao}` : ""}</p>}
        </div>
        <div className="w-full max-w-md">
          <CandidatePicker base={b} onPick={(c) => navigate(`/c/${c.id}${municipio ? `?mun=${municipio}` : ""}`)}
            placeholder="Trocar de candidatura…" />
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Stat valor={fmt(total)} rotulo={municipio ? `votos em ${titulo(b.munByCd.get(municipio)?.nome ?? "")}` : "votos no estado"} />
        <Stat valor={validos ? pct(total / validos) : "–"} rotulo="dos votos válidos do cargo" />
        <Stat valor={fmt(comVoto)} rotulo={municipio ? "bairros com voto" : "municípios com voto"} />
        <div className="ml-auto flex flex-wrap items-end gap-3">
          <MunicipioSelect base={b} value={municipio} onChange={(cd) => set("mun", cd)} />
          <Link className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
            to={`/dobrada?a=${cand.id}${municipio ? `&mun=${municipio}` : ""}`}>Comparar (dobrada)</Link>
        </div>
      </div>

      {votos.error && <ErrorBox error={votos.error} />}
      <MapControls modo={modo} setModo={(m) => set("modo", m)} metrica={metrica} setMetrica={(m) => set("metrica", m)}
        temMunicipio={!!municipio} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {dados ? (
          <MapView base={b} dados={dados} municipio={municipio} modo={modo} metrica={metrica}
            destaques={lista.filter((l) => l.votos > 0).slice(0, 20).map((l, i) => ({ rank: i + 1, nome: titulo(l.nome), lat: l.lat, lon: l.lon }))}
            onMunicipio={(cd) => set("mun", cd)} />
        ) : <Loading texto="Carregando votos…" />}
        <aside className="min-w-0">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">
            20 {municipio ? "bairros" : "cidades"} com mais votos
          </h2>
          <TopLista linhas={lista.filter((l) => l.votos > 0)} n={20}
            onClick={(l) => { if (!municipio) set("mun", l.key); }} />
        </aside>
      </div>

      {dados && <Rankings base={b} dados={dados} municipio={municipio}
        nomeArquivo={`${cand.numero}_${(cand.nome ?? "").replace(/\W+/g, "_")}${municipio ? `_${municipio}` : ""}`} />}
    </div>
  );
}
