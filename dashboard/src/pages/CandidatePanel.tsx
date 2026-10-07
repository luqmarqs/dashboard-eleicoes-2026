import { useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Historico, useHistorico } from "../components/Historico";
import { LazyMap } from "../components/LazyMap";
import type { Metrica, Modo } from "../components/mapTypes";
import { Rankings, TopLista } from "../components/Rankings";
import { SenadoAnalise } from "../components/SenadoAnalise";
import { AnunciosVotos } from "../components/AnunciosVotos";
import { useMetaAnuncios, useMetaResumo } from "../lib/metaHooks";
import { useQuery } from "@tanstack/react-query";
import { source, type MetaAnuncio } from "../lib/source";
import type { PorLocal } from "../lib/data";
import type { Candidatura } from "../lib/types";
import { CandidatePicker, ErrorBox, Loading, MapControls, MunicipioSelect, SituacaoBadge, Stat, nomeCand } from "../components/ui";
import { agregar, porLocal, useBase, useTotais, useVotos } from "../lib/data";
import { fmt, pct, titulo } from "../lib/format";
import { CARGOS } from "../lib/types";
import { useUf } from "../lib/uf";

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
  const { info } = useUf();
  const cand = base.data?.candById.get(Number(id));
  const votos = useVotos(cand ? [cand.id] : [], null);
  const hist = useHistorico(cand?.id);
  const temHistorico = (hist.data?.resumo.length ?? 0) > 0;
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
          <div className="eyebrow">{CARGOS[cand.cargo]} · {cand.partido} · {info.nome} · 1º turno 2026</div>
          <h1 className="display text-3xl md:text-4xl">{nomeCand(cand)}<SituacaoBadge c={cand} /></h1>
          {cand.nomeCompleto && <p className="text-muted">{cand.nomeCompleto}{cand.situacao ? ` · ${cand.situacao}` : ""}</p>}
        </div>
        <div className="w-full max-w-md">
          <CandidatePicker base={b} onPick={(c) => navigate(`/c/${c.id}${municipio ? `?mun=${municipio}` : ""}`)}
            placeholder="Trocar de candidatura…" />
        </div>
      </header>

      {/* Senado: análise própria (todas as candidaturas ao cargo, posição, vagas, adversário) */}
      {cand.cargo === 5 && cand.tipo === "nominal" ? (
        <SenadoAnalise base={b} cand={cand} municipio={municipio} setMunicipio={(cd) => set("mun", cd)} />
      ) : (<>
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
          <LazyMap base={b} dados={dados} municipio={municipio} modo={modo} metrica={metrica}
            destaques={lista.filter((l) => l.votos > 0).slice(0, 20).map((l, i) => ({ rank: i + 1, nome: titulo(l.nome), lat: l.lat, lon: l.lon }))}
            onMunicipio={(cd) => set("mun", cd)} />
        ) : <Loading texto="Carregando votos…" />}
        <aside className="min-w-0 lg:max-h-[min(70vh,720px)] lg:overflow-y-auto">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide">
            20 {municipio ? "bairros" : "cidades"} com mais votos
          </h2>
          <TopLista linhas={lista.filter((l) => l.votos > 0)} n={20}
            onClick={(l) => { if (!municipio) set("mun", l.key); }} />
        </aside>
      </div>

      {/* Com histórico, a tabela de comparação já traz 2026 completo (votos, % válidos, % do total). */}
      {dados && temHistorico && <Historico base={b} cand={cand} dados={dados} municipio={municipio} />}

      {dados && !hist.isLoading && !temHistorico && <Rankings base={b} dados={dados} municipio={municipio}
        nomeArquivo={`${cand.numero}_${(cand.nome ?? "").replace(/\W+/g, "_")}${municipio ? `_${municipio}` : ""}`} />}
      </>)}

      {/* tráfego pago × votos (próprios; sem anúncios próprios, os de outras campanhas que citam a candidatura) */}
      {dados && !municipio && <PublicidadeCandidatura cand={cand} dados={dados} />}
    </div>
  );
}

/** Anúncios × votos por cidade no painel da candidatura (só se houver anúncios coletados da Biblioteca da Meta). */
function PublicidadeCandidatura({ cand, dados }: { cand: Candidatura; dados: PorLocal }) {
  const base = useBase();
  const resumo = useMetaResumo();
  const item = resumo.data?.candidaturas.find((c) => c.candidatura_id === cand.id);
  const proprios = !!item && item.anuncios > 0;
  const ads = useMetaAnuncios(cand.id, item?.ultima_coleta, proprios);
  const { uf } = useUf();
  const dob = useQuery({ queryKey: ["meta-dobradas", uf, cand.id], queryFn: () => source.metaDobradas(cand.id),
    enabled: !!item && !proprios, staleTime: 5 * 60_000 });
  const deTerceiros = useMemo(() => {
    const m = new Map<string, MetaAnuncio>();
    for (const x of dob.data ?? []) if (x.papel === "recebe") m.set(x.ad.id, x.ad);
    return [...m.values()];
  }, [dob.data]);
  const votosMun = useMemo(() => new Map((base.data ? agregar(base.data, dados, "municipio") : []).map((l) => [l.key, l])), [base.data, dados]);
  const lista = proprios ? ads.data ?? [] : deTerceiros;
  if (!base.data || !item || !lista.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <AnunciosVotos base={base.data} ads={lista} votosMun={votosMun} nome={cand.nome} deTerceiros={!proprios} />
      <Link to={`/publicidade?c=${cand.id}`} className="self-end text-sm text-accent">Ver os anúncios, mapa e temas na página Publicidade →</Link>
    </div>
  );
}
