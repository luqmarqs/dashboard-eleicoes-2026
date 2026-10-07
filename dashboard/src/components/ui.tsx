import { useMemo, useState, type ReactNode } from "react";
import type { Base } from "../lib/data";
import { deUf, useUf } from "../lib/uf";
import { fmt, normalizar, titulo } from "../lib/format";
import { CARGOS, type Candidatura } from "../lib/types";
import { MODOS, type Metrica, type Modo } from "./mapTypes";
import { L } from "../lib/i18n";

export function Stat({ valor, rotulo }: { valor: ReactNode; rotulo: ReactNode }) {
  return (
    <div className="flex flex-col">
      <b className="display text-2xl num">{valor}</b>
      <span className="text-sm text-muted">{rotulo}</span>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { id: T; label: string; ajuda?: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-md border border-line bg-panel p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} title={o.ajuda}
          onClick={() => onChange(o.id)}
          className={`rounded px-3 py-1 text-sm ${value === o.id ? "bg-accent text-panel font-semibold" : "hover:bg-accent-soft"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MapControls({ modo, setModo, metrica, setMetrica, temMunicipio }: {
  modo: Modo; setModo: (m: Modo) => void; metrica: Metrica; setMetrica: (m: Metrica) => void; temMunicipio: boolean;
}) {
  const modos = MODOS().filter((m) => temMunicipio || m.id !== "territorios").filter((m) => !temMunicipio || m.id !== "municipios");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label={L("Modo do mapa", "Map mode")} value={modo} onChange={setModo} options={modos} />
      {modo !== "calor" && (
        <Segmented label={L("Métrica", "Metric")} value={metrica} onChange={setMetrica}
          options={[{ id: "pct", label: L("% dos válidos", "% of valid votes") }, { id: "votos", label: L("Votos", "Votes") }]} />
      )}
    </div>
  );
}

export function MunicipioSelect({ base, value, onChange, id = "municipio" }: {
  base: Base; value: string | null; onChange: (cd: string | null) => void; id?: string;
}) {
  const opts = useMemo(() => [...base.municipios].sort((a, b) => a.nome.localeCompare(b.nome)), [base]);
  const { info } = useUf();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm text-muted">
      {L("Abrangência", "Scope")}
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}
        className="rounded-md border border-line bg-panel px-3 py-1.5 text-ink">
        <option value="">{L(`Estado ${deUf(info)}`, `State of ${info.nome}`)}</option>
        {opts.map((m) => <option key={m.cd} value={m.cd}>{titulo(m.nome)}</option>)}
      </select>
    </label>
  );
}

/** Texto da situação oficial no idioma atual (os valores dos dados continuam em português). */
export function situacaoTexto(s: string): string {
  switch (s) {
    case "Eleito por QP": return L(s, "Elected (party quota)");
    case "Eleito por média": return L(s, "Elected (average)");
    case "Eleito": return L(s, "Elected");
    case "2º turno": return L(s, "Runoff");
    case "Suplente": return L(s, "Alternate");
    case "Não eleito": return L(s, "Not elected");
    default: return s;
  }
}

/** Selo da situação oficial: Eleito (por QP / média), 2º turno, Suplente. "Não eleito" não leva selo. */
export function SituacaoBadge({ c, compacto = false }: { c: Pick<Candidatura, "situacao">; compacto?: boolean }) {
  const s = c.situacao ?? "";
  if (s.startsWith("Eleito")) {
    const como = s.replace(/^Eleito\s*/, "");
    return (
      <span title={situacaoTexto(s)} className="ml-1.5 inline-flex items-center rounded bg-accent px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-panel">
        {compacto || !como ? L("Eleito", "Elected") : situacaoTexto(s)}
      </span>
    );
  }
  if (s === "2º turno") {
    return <span title={situacaoTexto(s)} className="ml-1.5 inline-flex rounded border border-accent px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-accent">{L("2º turno", "Runoff")}</span>;
  }
  if (s === "Suplente" && !compacto) {
    return <span title={situacaoTexto(s)} className="ml-1.5 inline-flex rounded border border-line px-1.5 py-0.5 align-middle text-[10px] uppercase tracking-wide text-muted">{L("Suplente", "Alternate")}</span>;
  }
  return null;
}

export function nomeCand(c: Candidatura) {
  return c.tipo === "legenda" ? L(`Legenda ${c.partido ?? c.numero}`, `${c.partido ?? c.numero} party-list vote`) : `${c.numero} · ${c.nome}`;
}

/** Busca de qualquer candidatura (todos os partidos). */
export function CandidatePicker({ base, onPick, cargo, placeholder, id = "busca-cand" }: {
  base: Base; onPick: (c: Candidatura) => void; cargo?: number; placeholder?: string; id?: string;
}) {
  const [q, setQ] = useState("");
  const res = useMemo(() => {
    const t = normalizar(q.trim());
    if (t.length < 2) return [];
    return base.candidaturas
      .filter((c) => (cargo == null || c.cargo === cargo) &&
        normalizar(`${c.numero} ${c.nome} ${c.nomeCompleto ?? ""} ${c.partido ?? ""}`).includes(t))
      .sort((a, b) => b.votos - a.votos)
      .slice(0, 12);
  }, [q, base, cargo]);
  return (
    <div className="relative">
      <input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? L("Buscar candidatura por nome, número ou partido…", "Search candidate by name, number or party…")}
        className="w-full rounded-md border border-line bg-panel px-3 py-2" autoComplete="off" />
      {res.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border border-line bg-panel shadow-lg">
          {res.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-accent-soft"
                onClick={() => { onPick(c); setQ(""); }}>
                <span className="font-semibold">{nomeCand(c)}<SituacaoBadge c={c} compacto /></span>
                <span className="text-sm text-muted">{c.partido} · {CARGOS[c.cargo]}</span>
                <span className="num ml-auto text-sm">{fmt(c.votos)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Loading({ texto }: { texto?: string }) {
  return <p className="py-10 text-center text-muted" role="status">{texto ?? L("Carregando dados…", "Loading data…")}</p>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <p className="rounded-md border border-danger px-4 py-3 text-danger" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
