/**
 * Fonte de dados do dashboard. Em produção, funções RPC do Supabase (com login + RLS);
 * no desenvolvimento local (VITE_DATA_SOURCE=dev), arquivos de dev-data/ no mesmo formato.
 */
import type {
  CandidaturasCols, Config, LocaisCols, MunicipiosCols, Painel, TopCandidatura, TotaisCols, VotosCols,
} from "./types";
import { supabase } from "./supabase";

export const UF = "sp";
export const isDev = import.meta.env.VITE_DATA_SOURCE === "dev" && import.meta.env.DEV;

export interface DataSource {
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
  if (!r.ok) throw new Error(`Falha ao carregar ${url} (HTTP ${r.status})`);
  return r.json() as Promise<T>;
}

function rpcError(fn: string, error: { message: string } | null): never {
  throw new Error(`Erro ao consultar ${fn}: ${error?.message ?? "resposta vazia"}`);
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

const devBase = `/dev-data/${UF}`;
let devLocaisPorMun: Map<string, Set<number>> | null = null;
async function devMunSet(cd?: string | null): Promise<Set<number> | null> {
  if (!cd) return null;
  if (!devLocaisPorMun) {
    const l = await getJson<LocaisCols>(`${devBase}/locais.json`);
    devLocaisPorMun = new Map();
    l.id.forEach((id, i) => {
      const s = devLocaisPorMun!.get(l.mun[i]) ?? new Set<number>();
      s.add(id);
      devLocaisPorMun!.set(l.mun[i], s);
    });
  }
  return devLocaisPorMun.get(cd) ?? new Set();
}

const PAINEIS_KEY = "paineis-dev";
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
    const own = JSON.parse(localStorage.getItem(PAINEIS_KEY) ?? "[]") as Painel[];
    return [...PAINEIS_PADRAO, ...own.filter((p) => !p.id.startsWith("padrao-"))];
  } catch {
    return PAINEIS_PADRAO;
  }
}

const dev: DataSource = {
  locais: () => getJson(`${devBase}/locais.json`),
  candidaturas: () => getJson(`${devBase}/candidaturas.json`),
  municipios: () => getJson(`${devBase}/municipios.json`),
  config: () => getJson(`${devBase}/config.json`),
  async votos(ids, cd) {
    const allowed = await devMunSet(cd);
    const out: Record<number, VotosCols> = {};
    await Promise.all(ids.map(async (id) => {
      try {
        out[id] = filterByMunicipio(await getJson<VotosCols>(`${devBase}/votos/${id}.json`), allowed);
      } catch {
        out[id] = { local: [], votos: [] };
      }
    }));
    return out;
  },
  async totais(cargo, cd) {
    const t = await getJson<TotaisCols>(`${devBase}/totais/${cargo}.json`);
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
      localStorage.setItem(PAINEIS_KEY, JSON.stringify(next));
    } catch {
      /* armazenamento indisponível: painel vale só nesta sessão */
    }
    return painel;
  },
  async apagarPainel(id) {
    try {
      localStorage.setItem(PAINEIS_KEY, JSON.stringify(devPaineis().filter((p) => p.id !== id)));
    } catch {
      /* ignora */
    }
  },
};

const remote: DataSource = {
  locais: () => rpc("locais_json"),
  candidaturas: () => rpc("candidaturas_json"),
  async municipios() {
    const { data, error } = await supabase().from("municipios").select("cd_municipio, cd_ibge, nome, lat, lon")
      .order("cd_municipio").range(0, 999);
    if (error || !data) rpcError("municipios", error);
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
    if (p.error || c.error) rpcError("configuração", p.error ?? c.error);
    return {
      partidos: (p.data ?? []).map((r) => ({ sigla: r.sg_partido, ordem: r.ordem, cor: r.cor })),
      candidaturas: (c.data ?? []).map((r) => r.candidatura_id),
    };
  },
  votos: (ids, cd) => rpc("votos_candidaturas", { p_ids: ids, p_cd_municipio: cd ?? null }),
  totais: (cargo, cd) => rpc("totais_cargo", { p_cargo: cargo, p_cd_municipio: cd ?? null }),
  topCandidaturas: (partido, cargo, cd, limite) =>
    rpc("top_candidaturas", { p_partido: partido, p_cargo: cargo, p_cd_municipio: cd, p_limite: limite }),
  async paineis() {
    const { data, error } = await supabase().from("paineis")
      .select("id, titulo, candidatura_ids, regra, cd_municipio, autor, criado_em, grupo, ordem")
      .order("grupo", { ascending: true, nullsFirst: false }).order("ordem", { ascending: true, nullsFirst: false })
      .order("criado_em", { ascending: false });
    if (error) rpcError("painéis", error);
    return data ?? [];
  },
  async salvarPainel(p) {
    const row = { titulo: p.titulo, candidatura_ids: p.candidatura_ids, regra: p.regra ?? null, cd_municipio: p.cd_municipio };
    const q = p.id
      ? supabase().from("paineis").update({ ...row, atualizado_em: new Date().toISOString() }).eq("id", p.id)
      : supabase().from("paineis").insert(row);
    const { data, error } = await q.select("id, titulo, candidatura_ids, regra, cd_municipio, autor, criado_em").single();
    if (error || !data) rpcError("salvar painel", error);
    return data;
  },
  async apagarPainel(id) {
    const { error } = await supabase().from("paineis").delete().eq("id", id);
    if (error) rpcError("apagar painel", error);
  },
};

export const source: DataSource = isDev ? dev : remote;

export const geoUrl = {
  municipios: `/geo/${UF}/municipios.json`,
  territorios: (ibge: number) => `/geo/${UF}/territorios/${ibge}.json`,
};
