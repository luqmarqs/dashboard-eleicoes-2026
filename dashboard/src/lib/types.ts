import { getLang } from "./i18n";
/** Formatos colunares devolvidos pelas funções do Supabase (e pelos arquivos de dev-data). */

export interface LocaisCols {
  id: number[];
  mun: string[];
  zona: number[];
  nr: number[];
  nome: string[];
  end: (string | null)[];
  bairro: string[];
  lat: number[];
  lon: number[];
  aprox: boolean[];
  secoes: number[];
}

export interface CandidaturasCols {
  id: number[];
  cargo: number[];
  tipo: ("nominal" | "legenda")[];
  numero: number[];
  nome: (string | null)[];
  nomeCompleto: (string | null)[];
  partido: (string | null)[];
  destinacao: (string | null)[];
  votos: number[];
  situacao?: (string | null)[];
}

export interface MunicipiosCols {
  cd: string[];
  ibge: number[];
  nome: string[];
  lat: number[];
  lon: number[];
}

export interface VotosCols {
  local: number[];
  votos: number[];
}

export interface TotaisCols {
  local: number[];
  validos: number[];
  comparecimento: number[];
  aptos: number[];
}

export interface Config {
  partidos: { sigla: string; ordem: number; cor: string }[];
  candidaturas: number[];
}

export interface TopCandidatura {
  candidatura_id: number;
  numero: number;
  nm_urna: string;
  votos: number;
}

export interface RegraPainel {
  partido: string;
  cargos: number[];
  top: number;
}

export interface Painel {
  id: string;
  titulo: string;
  candidatura_ids: number[];
  regra?: RegraPainel | null;
  cd_municipio: string | null;
  grupo?: string | null;
  ordem?: number | null;
  autor?: string;
  criado_em?: string;
}

/** Linhas já resolvidas, usadas na interface. */
export interface Local {
  idx: number;
  id: number;
  mun: string;
  munNome: string;
  ibge: number;
  zona: number;
  nr: number;
  nome: string;
  end: string | null;
  bairro: string;
  lat: number;
  lon: number;
  aprox: boolean;
  secoes: number;
}

export interface Candidatura {
  id: number;
  cargo: number;
  tipo: "nominal" | "legenda";
  numero: number;
  nome: string;
  nomeCompleto: string | null;
  partido: string | null;
  destinacao: string | null;
  votos: number;
  situacao: string | null;
}

export interface Municipio {
  cd: string;
  ibge: number;
  nome: string;
  lat: number;
  lon: number;
}

const CARGOS_PT: Record<number, string> = { 1: "Presidente", 3: "Governador", 5: "Senador", 6: "Deputado Federal", 7: "Deputado Estadual" };
const CARGOS_EN: Record<number, string> = { 1: "President", 3: "Governor", 5: "Senator", 6: "Federal Deputy", 7: "State Deputy" };
/** Nome do cargo no idioma da interface. */
export const CARGOS: Record<number, string> = new Proxy({} as Record<number, string>, {
  get: (_t, k) => (getLang() === "en" ? CARGOS_EN : CARGOS_PT)[Number(String(k))],
  has: (_t, k) => Number(String(k)) in CARGOS_PT,
  ownKeys: () => Object.keys(CARGOS_PT),
  getOwnPropertyDescriptor: (_t, k) => ({ enumerable: true, configurable: true,
    value: (getLang() === "en" ? CARGOS_EN : CARGOS_PT)[Number(String(k))] }),
});
