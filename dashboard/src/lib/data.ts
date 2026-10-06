import { useQuery } from "@tanstack/react-query";
import { source } from "./source";
import type { Candidatura, Local, Municipio, TotaisCols, VotosCols } from "./types";

export interface Base {
  locais: Local[];
  localById: Map<number, Local>;
  candidaturas: Candidatura[];
  candById: Map<number, Candidatura>;
  municipios: Municipio[];
  munByCd: Map<string, Municipio>;
  partidosDestaque: { sigla: string; cor: string }[];
  candidaturasDestaque: number[];
}

async function loadBase(): Promise<Base> {
  const [l, c, m, cfg] = await Promise.all([
    source.locais(), source.candidaturas(), source.municipios(), source.config(),
  ]);
  const municipios: Municipio[] = m.cd.map((cd, i) => ({ cd, ibge: m.ibge[i], nome: m.nome[i], lat: m.lat[i], lon: m.lon[i] }));
  const munByCd = new Map(municipios.map((x) => [x.cd, x]));
  const locais: Local[] = l.id.map((id, i) => {
    const mun = munByCd.get(l.mun[i]);
    return {
      idx: i, id, mun: l.mun[i], munNome: mun?.nome ?? l.mun[i], ibge: mun?.ibge ?? 0, zona: l.zona[i], nr: l.nr[i],
      nome: l.nome[i], end: l.end[i], bairro: l.bairro[i], lat: l.lat[i], lon: l.lon[i], aprox: l.aprox[i],
      secoes: l.secoes[i],
    };
  });
  const candidaturas: Candidatura[] = c.id.map((id, i) => ({
    id, cargo: c.cargo[i], tipo: c.tipo[i], numero: c.numero[i], nome: c.nome[i] ?? String(c.numero[i]),
    nomeCompleto: c.nomeCompleto[i], partido: c.partido[i], destinacao: c.destinacao[i], votos: c.votos[i],
  }));
  return {
    locais, localById: new Map(locais.map((x) => [x.id, x])),
    candidaturas, candById: new Map(candidaturas.map((x) => [x.id, x])),
    municipios, munByCd,
    partidosDestaque: cfg.partidos.sort((a, b) => a.ordem - b.ordem).map(({ sigla, cor }) => ({ sigla, cor })),
    candidaturasDestaque: cfg.candidaturas,
  };
}

export function useBase() {
  return useQuery({ queryKey: ["base"], queryFn: loadBase, staleTime: Infinity, gcTime: Infinity });
}

export function useVotos(ids: number[], cd?: string | null) {
  const key = [...ids].sort((a, b) => a - b);
  return useQuery({
    queryKey: ["votos", key, cd ?? null],
    queryFn: () => source.votos(key, cd),
    enabled: key.length > 0,
    staleTime: Infinity,
  });
}

export function useTotais(cargo: number | undefined, cd?: string | null) {
  return useQuery({
    queryKey: ["totais", cargo, cd ?? null],
    queryFn: () => source.totais(cargo!, cd),
    enabled: cargo != null,
    staleTime: Infinity,
  });
}

export function useTop(partido: string, cargo: number, cd: string | null, limite: number) {
  return useQuery({
    queryKey: ["top", partido, cargo, cd, limite],
    queryFn: () => source.topCandidaturas(partido, cargo, cd, limite),
    staleTime: Infinity,
  });
}

// ---------------------------------------------------------------------------------------------
// Agregações (no navegador: ~11 mil locais por candidatura é pouco)
// ---------------------------------------------------------------------------------------------

/** Votos e válidos por local (índice = Local.idx). */
export interface PorLocal {
  votos: Float64Array;
  validos: Float64Array;
  total: number;
  totalValidos: number;
}

export function porLocal(base: Base, v: VotosCols | undefined, t: TotaisCols | undefined): PorLocal {
  const n = base.locais.length;
  const votos = new Float64Array(n);
  const validos = new Float64Array(n);
  let total = 0;
  let totalValidos = 0;
  v?.local.forEach((id, i) => {
    const l = base.localById.get(id);
    if (l) {
      votos[l.idx] += v.votos[i];
      total += v.votos[i];
    }
  });
  t?.local.forEach((id, i) => {
    const l = base.localById.get(id);
    if (l) {
      validos[l.idx] += t.validos[i];
      totalValidos += t.validos[i];
    }
  });
  return { votos, validos, total, totalValidos };
}

export type Nivel = "municipio" | "bairro" | "local";

export interface LinhaAgregada {
  key: string;
  nome: string;
  municipio: string;
  bairro?: string;
  endereco?: string | null;
  zona?: number;
  locais: number;
  secoes: number;
  votos: number;
  validos: number;
  pct: number;
  lat: number;
  lon: number;
  localIds: number[];
}

export function agregar(base: Base, pl: PorLocal, nivel: Nivel, cdMunicipio?: string | null): LinhaAgregada[] {
  const map = new Map<string, LinhaAgregada & { wlat: number; wlon: number; w: number }>();
  for (const l of base.locais) {
    if (cdMunicipio && l.mun !== cdMunicipio) continue;
    const key = nivel === "municipio" ? l.mun : nivel === "bairro" ? `${l.mun}|${l.bairro}` : String(l.id);
    const nome = nivel === "municipio" ? l.munNome : nivel === "bairro" ? l.bairro : l.nome;
    let row = map.get(key);
    if (!row) {
      row = {
        key, nome, municipio: l.munNome, bairro: nivel !== "municipio" ? l.bairro : undefined,
        endereco: nivel === "local" ? l.end : undefined, zona: nivel === "local" ? l.zona : undefined,
        locais: 0, secoes: 0, votos: 0, validos: 0, pct: 0, lat: 0, lon: 0, localIds: [], wlat: 0, wlon: 0, w: 0,
      };
      map.set(key, row);
    }
    const v = pl.votos[l.idx];
    row.locais += 1;
    row.secoes += l.secoes;
    row.votos += v;
    row.validos += pl.validos[l.idx];
    row.localIds.push(l.id);
    const w = v > 0 ? v : 1e-6; // posição ponderada pelos votos (ou centro simples)
    row.wlat += l.lat * w;
    row.wlon += l.lon * w;
    row.w += w;
  }
  const out: LinhaAgregada[] = [];
  for (const r of map.values()) {
    const { wlat, wlon, w, ...rest } = r;
    out.push({ ...rest, pct: r.validos ? r.votos / r.validos : 0, lat: wlat / w, lon: wlon / w });
  }
  return out.sort((a, b) => b.votos - a.votos || a.nome.localeCompare(b.nome));
}
