/**
 * Fonte de dados do dashboard. Em produção, funções RPC do Supabase (com login + RLS);
 * no desenvolvimento local (VITE_DATA_SOURCE=dev), arquivos de dev-data/ no mesmo formato.
 */
import type {
  CandidaturasCols, Config, LocaisCols, MunicipiosCols, Painel, TopCandidatura, TotaisCols, VotosCols,
} from "./types";
import { supabase } from "./supabase";
import { getUf } from "./uf";
import { L } from "./i18n";
export const isDev = import.meta.env.VITE_DATA_SOURCE === "dev" && import.meta.env.DEV;

export interface DadosRegra {
  top: TopCandidatura[];
  votos: Record<number, VotosCols>;
  totais: TotaisCols;
}

export interface Historico {
  resumo: { candidatura_id: number; ano: number; cd_cargo: number; numero: number; votos_total: number }[];
  nivel: string[];
  mun: string[];
  chave: string[];
  votos: number[];
  validos: number[];
  ano: number[];
}

/** Anúncio da Biblioteca de Anúncios da Meta (faixas: [min, max]; max nulo = faixa aberta). */
export interface MetaAnuncio {
  id: string;
  page_id: string;
  page_name: string | null;
  bylines: string | null;
  criado: string | null;
  inicio: string | null;
  fim: string | null;
  textos: string[] | null;
  titulos: string[] | null;
  plataformas: string[] | null;
  moeda: string | null;
  gasto: [number | null, number | null];
  impressoes: [number | null, number | null];
  alcance: number | null;
  publico: [number | null, number | null];
  idades: string[] | null;
  genero: string | null;
  link: string;
  primeira_coleta: string;
  ultima_coleta: string;
  /** [nivel, tipo, excluida, uf, municipio_nome, cd_ibge, cd_municipio (TSE), bairro, cep, status, nome_original] */
  loc: [string, string | null, boolean, string | null, string | null, number | null, string | null, string | null, string | null, string, string][];
  /** [UF ou região, proporção do alcance] */
  entrega: [string, number | null][];
}

export interface MetaPagina {
  page_id: string;
  page_name: string | null;
  natureza: "oficial" | "partido" | "apoiador" | "nao_confirmado";
  status_revisao: "confirmado" | "a_revisar" | "rejeitado";
  evidencia: string | null;
  coletar: boolean;
}

export interface MetaResumo {
  execucao: {
    id: string; status: string; versao_api: string; iniciada_em: string; terminada_em: string | null;
    periodo_min: string | null; paginas_alvo: number; paginas_concluidas: number | null; paginas_com_falha: number | null;
  } | null;
  ultima_completa: string | null;
  candidaturas: {
    candidatura_id: number; paginas: MetaPagina[]; anuncios: number; gasto_min: number | null; gasto_max: number | null;
    gasto_aberto: boolean | null; moedas: number; ultima_coleta: string | null;
  }[];
}

/** Resposta compacta de meta_anuncios_compacto: dicionários de localidades e textos + colunas por anúncio. */
interface MetaCompacto {
  locs: [string, string | null, string | null, string | null, number | null, string | null, string | null, string | null, string, string][];
  textos: [string[] | null, string[] | null][];
  id: string[]; page_id: string[]; page_name: (string | null)[]; bylines: (string | null)[]; criado: (string | null)[];
  inicio: (string | null)[]; fim: (string | null)[]; texto: number[]; plataformas: (string[] | null)[]; moeda: (string | null)[];
  gmin: (number | null)[]; gmax: (number | null)[]; imin: (number | null)[]; imax: (number | null)[]; alcance: (number | null)[];
  pmin: (number | null)[]; pmax: (number | null)[]; idades: (string[] | null)[]; genero: (string | null)[];
  primeira: string[]; ultima: string[]; loc: number[][]; entrega: [string, number | null][][];
}

function expandirCompacto(c: MetaCompacto): MetaAnuncio[] {
  return c.id.map((id, i) => {
    const [textos, titulos] = c.textos[c.texto[i]] ?? [null, null];
    return {
      id, page_id: c.page_id[i], page_name: c.page_name[i], bylines: c.bylines[i], criado: c.criado[i], inicio: c.inicio[i],
      fim: c.fim[i], textos, titulos, plataformas: c.plataformas[i], moeda: c.moeda[i], gasto: [c.gmin[i], c.gmax[i]],
      impressoes: [c.imin[i], c.imax[i]], alcance: c.alcance[i], publico: [c.pmin[i], c.pmax[i]], idades: c.idades[i],
      genero: c.genero[i], link: `https://www.facebook.com/ads/library/?id=${id}`, primeira_coleta: c.primeira[i],
      ultima_coleta: c.ultima[i],
      loc: (c.loc[i] ?? []).map((k) => {
        const L = c.locs[Math.abs(k) - 1];
        return [L[0], L[1], k < 0, L[2], L[3], L[4], L[5], L[6], L[7], L[8], L[9]] as MetaAnuncio["loc"][number];
      }),
      entrega: c.entrega[i] ?? [],
    };
  });
}

/** Menção de dobrada: 'recebe' = outra campanha (outra) cita esta; 'faz' = esta cita outra (outra). */
export interface MetaMencao {
  papel: "recebe" | "faz";
  outra: number | null;
  cita_nome: boolean;
  cita_numero: boolean;
  confirmada: boolean;
  cnpjs_texto: string | null;
  cnpj_financiador: string | null;
  ad: MetaAnuncio;
}

/** Painel "Evolução digital e votação" (MG). Ausência = null, nunca zero. */
export interface DigitalPerfil {
  perfil_key: string; plataforma: string; perfil_id: string | null; username: string; url: string; nome_publico: string | null;
  candidatura_id: number | null; uf: string; status_vinculo: "confirmado" | "pendente" | "rejeitado"; evidencia: string | null;
}
export interface DigitalObs {
  perfil_key: string; observado_em: string | null; data: string | null; origem_data: string; seguidores: number | null;
  seguindo: number | null; posts: number | null; precisao: string; fonte: string; fonte_arquivo: string | null; status: string;
}
export interface DigitalExecucao {
  id: string; iniciada_em: string; terminada_em: string | null; tipo: string; perfis_solicitados: number | null;
  perfis_obtidos: number | null; falhas: Record<string, string> | null; custo_usd: number | null; custo_confirmado: boolean | null;
  teto_usd: number | null; proveniencia: string | null;
}
export interface Digital {
  perfis: DigitalPerfil[];
  observacoes: DigitalObs[];
  posts: { perfil_key: string[]; publicado: (string | null)[]; tipo: (string | null)[]; curtidas: (number | null)[];
    comentarios: (number | null)[]; views: (number | null)[]; url: (string | null)[]; fixado: boolean[]; coletado: string[];
    coautoria: boolean[] };
  execucoes: DigitalExecucao[];
}

export interface DataSource {
  digital(): Promise<Digital>;
  metaDobradas(candidaturaId: number): Promise<MetaMencao[]>;
  metaResumo(): Promise<MetaResumo>;
  metaAnuncios(candidaturaId: number): Promise<MetaAnuncio[]>;
  historico(id: number): Promise<Historico>;
  versao(): Promise<string>;
  dadosRegra(partido: string, cargo: number, cdMunicipio: string | null, limite: number): Promise<DadosRegra>;
  locais(): Promise<LocaisCols>;
  candidaturas(): Promise<CandidaturasCols>;
  municipios(): Promise<MunicipiosCols>;
  config(): Promise<Config>;
  votos(ids: number[], cdMunicipio?: string | null): Promise<Record<number, VotosCols>>;
  totais(cargo: number, cdMunicipio?: string | null): Promise<TotaisCols>;
  topCandidaturas(partido: string, cargo: number, cdMunicipio: string | null, limite: number): Promise<TopCandidatura[]>;
  paineis(): Promise<Painel[]>;
  salvarPainel(p: Omit<Painel, "id"> & { id?: string }): Promise<Painel>;
  apagarPainel(id: string): Promise<void>;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(L(`Falha ao carregar ${url} (HTTP ${r.status})`, `Failed to load ${url} (HTTP ${r.status})`));
  return r.json() as Promise<T>;
}

function rpcError(fn: string, error: { message: string } | null): never {
  throw new Error(L(`Erro ao consultar ${fn}: ${error?.message ?? "resposta vazia"}`, `Error querying ${fn}: ${error?.message ?? "empty response"}`));
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error || data == null) rpcError(fn, error);
  return data as T;
}

/** Filtra um VotosCols completo para os locais de um município (modo dev). */
function filterByMunicipio(v: VotosCols, allowed: Set<number> | null): VotosCols {
  if (!allowed) return v;
  const out: VotosCols = { local: [], votos: [] };
  v.local.forEach((l, i) => {
    if (allowed.has(l)) {
      out.local.push(l);
      out.votos.push(v.votos[i]);
    }
  });
  return out;
}

const devBase = () => `/dev-data/${getUf().toLowerCase()}`;
let devLocaisPorMun: Map<string, Set<number>> | null = null;
let devLocaisUf = "";
async function devMunSet(cd?: string | null): Promise<Set<number> | null> {
  if (!cd) return null;
  if (!devLocaisPorMun || devLocaisUf !== getUf()) {
    devLocaisUf = getUf();
    const l = await getJson<LocaisCols>(`${devBase()}/locais.json`);
    devLocaisPorMun = new Map();
    l.id.forEach((id, i) => {
      const s = devLocaisPorMun!.get(l.mun[i]) ?? new Set<number>();
      s.add(id);
      devLocaisPorMun!.set(l.mun[i], s);
    });
  }
  return devLocaisPorMun.get(cd) ?? new Set();
}

const paineisKey = () => `paineis-dev-${getUf()}`;
const PAINEIS_PADRAO: Painel[] = [
  { id: "padrao-psol", titulo: "PSOL · 10 mais votados (federal e estadual)", candidatura_ids: [],
    regra: { partido: "PSOL", cargos: [6, 7], top: 10 }, cd_municipio: null, grupo: "PSOL · comparativos", ordem: 1 },
  { id: "padrao-campinas", titulo: "PSOL em Campinas · 10 mais votados", candidatura_ids: [],
    regra: { partido: "PSOL", cargos: [6, 7], top: 10 }, cd_municipio: "62910", grupo: "PSOL · comparativos", ordem: 2 },
  { id: "padrao-capital", titulo: "PSOL em São Paulo (capital) · 10 mais votados", candidatura_ids: [],
    regra: { partido: "PSOL", cargos: [6, 7], top: 10 }, cd_municipio: "71072", grupo: "PSOL · comparativos", ordem: 3 },
];
function devPaineis(): Painel[] {
  try {
    const own = JSON.parse(localStorage.getItem(paineisKey()) ?? "[]") as Painel[];
    return [...(getUf() === "SP" ? PAINEIS_PADRAO : []), ...own.filter((p) => !p.id.startsWith("padrao-"))];
  } catch {
    return getUf() === "SP" ? PAINEIS_PADRAO : [];
  }
}

const HIST_VAZIO: Historico = { resumo: [], nivel: [], mun: [], chave: [], votos: [], validos: [], ano: [] };

const META_VAZIO: MetaResumo = { execucao: null, ultima_completa: null, candidaturas: [] };

const dev: DataSource = {
  async metaResumo() {
    try {
      return await getJson<MetaResumo>(`${devBase()}/meta/resumo.json`);
    } catch {
      return META_VAZIO;
    }
  },
  async digital() {
    try {
      return await getJson<Digital>(`${devBase()}/digital.json`);
    } catch {
      return { perfis: [], observacoes: [], posts: { perfil_key: [], publicado: [], tipo: [], curtidas: [], comentarios: [], views: [], url: [], fixado: [], coletado: [], coautoria: [] }, execucoes: [] };
    }
  },
  async metaDobradas(id) {
    try {
      return await getJson<MetaMencao[]>(`${devBase()}/meta/dobradas/${id}.json`);
    } catch {
      return [];
    }
  },
  async metaAnuncios(id) {
    try {
      return await getJson<MetaAnuncio[]>(`${devBase()}/meta/${id}.json`);
    } catch {
      return [];
    }
  },
  async historico(id) {
    try {
      return await getJson<Historico>(`${devBase()}/historico/${id}.json`);
    } catch {
      return HIST_VAZIO;
    }
  },
  versao: async () => "dev",
  async dadosRegra(partido, cargo, cd, limite) {
    const top = await dev.topCandidaturas(partido, cargo, cd, limite);
    const [votos, totais] = await Promise.all([dev.votos(top.map((t) => t.candidatura_id), cd), dev.totais(cargo, cd)]);
    return { top, votos, totais };
  },
  locais: () => getJson(`${devBase()}/locais.json`),
  candidaturas: () => getJson(`${devBase()}/candidaturas.json`),
  municipios: () => getJson(`${devBase()}/municipios.json`),
  config: () => getJson(`${devBase()}/config.json`),
  async votos(ids, cd) {
    const allowed = await devMunSet(cd);
    const out: Record<number, VotosCols> = {};
    await Promise.all(ids.map(async (id) => {
      try {
        out[id] = filterByMunicipio(await getJson<VotosCols>(`${devBase()}/votos/${id}.json`), allowed);
      } catch {
        out[id] = { local: [], votos: [] };
      }
    }));
    return out;
  },
  async totais(cargo, cd) {
    const t = await getJson<TotaisCols>(`${devBase()}/totais/${cargo}.json`);
    const allowed = await devMunSet(cd);
    if (!allowed) return t;
    const out: TotaisCols = { local: [], validos: [], comparecimento: [], aptos: [] };
    t.local.forEach((l, i) => {
      if (allowed.has(l)) {
        out.local.push(l);
        out.validos.push(t.validos[i]);
        out.comparecimento.push(t.comparecimento[i]);
        out.aptos.push(t.aptos[i]);
      }
    });
    return out;
  },
  async topCandidaturas(partido, cargo, cd, limite) {
    const c = await dev.candidaturas();
    const ids = c.id.filter((_, i) => c.partido[i] === partido && c.cargo[i] === cargo && c.tipo[i] === "nominal");
    let totals: [number, number][];
    if (!cd) {
      totals = ids.map((id) => [id, c.votos[c.id.indexOf(id)]]);
    } else {
      const v = await dev.votos(ids, cd);
      totals = ids.map((id) => [id, v[id].votos.reduce((a, b) => a + b, 0)]);
    }
    return totals.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, limite).map(([id, votos]) => {
      const i = c.id.indexOf(id);
      return { candidatura_id: id, numero: c.numero[i], nm_urna: c.nome[i] ?? "", votos };
    });
  },
  paineis: async () => devPaineis(),
  async salvarPainel(p) {
    const all = devPaineis();
    const painel: Painel = { ...p, id: p.id ?? crypto.randomUUID(), criado_em: new Date().toISOString() };
    const next = [painel, ...all.filter((x) => x.id !== painel.id)];
    try {
      localStorage.setItem(paineisKey(), JSON.stringify(next));
    } catch {
      /* armazenamento indisponível: painel vale só nesta sessão */
    }
    return painel;
  },
  async apagarPainel(id) {
    try {
      localStorage.setItem(paineisKey(), JSON.stringify(devPaineis().filter((p) => p.id !== id)));
    } catch {
      /* ignora */
    }
  },
};

const remote: DataSource = {
  historico: (id) => rpc("historico_json", { p_candidatura_id: id }),
  metaResumo: () => rpc("meta_resumo_cache", { p_uf: getUf() }),
  metaAnuncios: async (id) => expandirCompacto(await rpc<MetaCompacto>("meta_anuncios_cache", { p_candidatura_id: id })),
  metaDobradas: (id) => rpc("meta_dobradas_cache", { p_candidatura_id: id }),
  digital: () => rpc("digital_json", { p_uf: getUf() }),
  async versao() {
    const { data, error } = await supabase().from("meta").select("valor").eq("chave", "versao_dados").maybeSingle();
    if (error) rpcError(L("versão dos dados", "data version"), error);
    return data?.valor ?? "sem-versao";
  },
  dadosRegra: (partido, cargo, cd, limite) =>
    rpc("dados_regra", { p_partido: partido, p_cargo: cargo, p_cd_municipio: cd, p_limite: limite, p_uf: getUf() }),
  locais: () => rpc("locais_json", { p_uf: getUf() }),
  candidaturas: () => rpc("candidaturas_json", { p_uf: getUf() }),
  async municipios() {
    const { data, error } = await supabase().from("municipios").select("cd_municipio, cd_ibge, nome, lat, lon")
      .eq("uf", getUf()).order("cd_municipio").range(0, 999);
    if (error || !data) rpcError(L("municipios", "municipalities"), error);
    return {
      cd: data.map((r) => r.cd_municipio), ibge: data.map((r) => r.cd_ibge), nome: data.map((r) => r.nome),
      lat: data.map((r) => r.lat), lon: data.map((r) => r.lon),
    };
  },
  async config() {
    const [p, c] = await Promise.all([
      supabase().from("partidos_destaque").select("sg_partido, ordem, cor").order("ordem"),
      supabase().from("candidaturas_destaque").select("candidatura_id, ordem").order("ordem"),
    ]);
    if (p.error || c.error) rpcError(L("configuração", "configuration"), p.error ?? c.error);
    return {
      partidos: (p.data ?? []).map((r) => ({ sigla: r.sg_partido, ordem: r.ordem, cor: r.cor })),
      candidaturas: (c.data ?? []).map((r) => r.candidatura_id),
    };
  },
  votos: (ids, cd) => rpc("votos_candidaturas", { p_ids: ids, p_cd_municipio: cd ?? null }),
  totais: (cargo, cd) => rpc("totais_cargo", { p_cargo: cargo, p_cd_municipio: cd ?? null, p_uf: getUf() }),
  topCandidaturas: (partido, cargo, cd, limite) =>
    rpc("top_candidaturas", { p_partido: partido, p_cargo: cargo, p_cd_municipio: cd, p_limite: limite, p_uf: getUf() }),
  async paineis() {
    const { data, error } = await supabase().from("paineis")
      .select("id, titulo, candidatura_ids, regra, cd_municipio, autor, criado_em, grupo, ordem").eq("uf", getUf())
      .order("grupo", { ascending: true, nullsFirst: false }).order("ordem", { ascending: true, nullsFirst: false })
      .order("criado_em", { ascending: false });
    if (error) rpcError(L("painéis", "dashboards"), error);
    return data ?? [];
  },
  async salvarPainel(p) {
    const row = { titulo: p.titulo, candidatura_ids: p.candidatura_ids, regra: p.regra ?? null, cd_municipio: p.cd_municipio, uf: getUf() };
    const q = p.id
      ? supabase().from("paineis").update({ ...row, atualizado_em: new Date().toISOString() }).eq("id", p.id)
      : supabase().from("paineis").insert(row);
    const { data, error } = await q.select("id, titulo, candidatura_ids, regra, cd_municipio, autor, criado_em").single();
    if (error || !data) rpcError(L("salvar painel", "save dashboard"), error);
    return data;
  },
  async apagarPainel(id) {
    const { error } = await supabase().from("paineis").delete().eq("id", id);
    if (error) rpcError(L("apagar painel", "delete dashboard"), error);
  },
};

export const source: DataSource = isDev ? dev : remote;

export const geoUrl = {
  municipios: () => `/geo/${getUf().toLowerCase()}/municipios.json`,
  territorios: (ibge: number) => `/geo/${getUf().toLowerCase()}/territorios/${ibge}.json`,
};
