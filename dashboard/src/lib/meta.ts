/**
 * Cálculos da seção de publicidade (Biblioteca de Anúncios da Meta). Regras:
 * - gasto e impressões são FAIXAS acumuladas por anúncio; somam-se os limites (o total fica entre Σmin e Σmax);
 *   se algum anúncio não tem teto, o total também fica sem teto. Nunca ponto médio.
 * - moedas diferentes não se somam; alcance não se soma entre anúncios (a mesma pessoa pode ver vários).
 * - segmentação (o que o anunciante escolheu) ≠ entrega (onde a Meta diz que o anúncio chegou, por UF).
 * - um anúncio com várias cidades conta uma vez em cada cidade, mas o gasto dele não é dividido nem
 *   atribuído às cidades: "gasto dos anúncios associados" é o gasto total desses anúncios, em qualquer lugar.
 */
import { L, getLang, locale } from "./i18n";
import type { MetaAnuncio } from "./source";

export interface Faixa { min: number; max: number | null; n: number }

/** Soma de faixas por moeda. */
export function somaFaixas(ads: MetaAnuncio[], campo: "gasto" | "impressoes"): Map<string, Faixa> {
  const out = new Map<string, Faixa>();
  for (const a of ads) {
    const [lo, hi] = a[campo];
    if (lo == null && hi == null) continue; // ausente: não entra (≠ zero)
    const moeda = campo === "gasto" ? a.moeda ?? "?" : "";
    const f = out.get(moeda) ?? { min: 0, max: 0, n: 0 };
    f.min += lo ?? 0;
    f.max = f.max == null || hi == null ? null : f.max + hi;
    f.n += 1;
    out.set(moeda, f);
  }
  return out;
}

/** O anúncio circulou em algum momento do período? (não recorta o gasto acumulado do anúncio) */
export function circulou(a: MetaAnuncio, de: string | null, ate: string | null): boolean {
  if (ate && a.inicio && a.inicio > ate) return false;
  if (de && a.fim && a.fim < de) return false;
  return true;
}

export const LOC = { nivel: 0, tipo: 1, excluida: 2, uf: 3, municipio: 4, ibge: 5, cd: 6, bairro: 7, cep: 8, status: 9, nome: 10 } as const;

export type Abrangencia = "pais" | "uf" | "municipio" | "bairro" | "cep" | "desconhecida" | "sem_segmentacao";

/** Recorte mais fino entre as localidades INCLUÍDAS do anúncio. */
export function abrangencia(a: MetaAnuncio): Abrangencia {
  const inc = a.loc.filter((l) => !l[LOC.excluida]);
  if (!inc.length) return "sem_segmentacao";
  const ordem: Abrangencia[] = ["bairro", "cep", "municipio", "uf", "pais", "desconhecida"];
  for (const n of ordem) if (inc.some((l) => l[LOC.nivel] === n)) return n;
  return "desconhecida";
}

export interface PorMunicipio {
  cd: string;
  /** anúncios que incluem a cidade inteira */
  inclui: Set<string>;
  /** anúncios que incluem um bairro da cidade (cidade informada pela Meta e validada) */
  bairro: Set<string>;
  /** anúncios que excluem a cidade */
  exclui: Set<string>;
  inicio: string | null;
  fim: string | null;
}

/** Associação anúncio ↔ município (código TSE), só com correspondência validada. */
export function porMunicipio(ads: MetaAnuncio[]): Map<string, PorMunicipio> {
  const m = new Map<string, PorMunicipio>();
  const get = (cd: string) => {
    let x = m.get(cd);
    if (!x) { x = { cd, inclui: new Set(), bairro: new Set(), exclui: new Set(), inicio: null, fim: null }; m.set(cd, x); }
    return x;
  };
  for (const a of ads) {
    for (const l of a.loc) {
      const cd = l[LOC.cd];
      if (!cd || l[LOC.status] !== "validada") continue;
      const x = get(cd);
      if (l[LOC.excluida]) { x.exclui.add(a.id); continue; }
      (l[LOC.nivel] === "bairro" ? x.bairro : x.inclui).add(a.id);
      if (a.inicio && (!x.inicio || a.inicio < x.inicio)) x.inicio = a.inicio;
      const fim = a.fim ?? a.ultima_coleta?.slice(0, 10) ?? null;
      if (fim && (!x.fim || fim > x.fim)) x.fim = fim;
    }
  }
  return m;
}

export function mediana(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

// formatação no idioma da interface
const compactos = new Map<string, Intl.NumberFormat>();
function nfMeta(compact: boolean): Intl.NumberFormat {
  const k = `${locale()}|${compact}`;
  let f = compactos.get(k);
  if (!f) {
    f = new Intl.NumberFormat(locale(), compact ? { notation: "compact", maximumFractionDigits: 1 } : undefined);
    compactos.set(k, f);
  }
  return f;
}

export function fmtNum(n: number, compact = true): string {
  return compact && Math.abs(n) >= 10_000 ? nfMeta(true).format(n) : nfMeta(false).format(Math.round(n));
}

export function fmtFaixa(min: number | null, max: number | null, prefixo = ""): string {
  if (min == null && max == null) return L("não informado", "not reported");
  if (max == null) return `${prefixo}${fmtNum(min ?? 0)} ${L("ou mais", "or more")}`;
  if (min === max) return `${prefixo}${fmtNum(min ?? 0)}`;
  return `${prefixo}${fmtNum(min ?? 0)} – ${prefixo}${fmtNum(max)}`;
}

export const simbolo = (moeda: string) => (moeda === "BRL" ? "R$ " : moeda && moeda !== "?" ? `${moeda} ` : "");

export function fmtData(iso: string | null | undefined): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return getLang() === "en" ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}

export function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale(), { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

export function rotuloAbrangencia(a: Abrangencia): string {
  switch (a) {
    case "bairro": return L("Bairros", "Neighborhoods");
    case "cep": return L("CEPs", "ZIP codes");
    case "municipio": return L("Cidades", "Cities");
    case "uf": return L("Estado inteiro", "Whole state");
    case "pais": return L("Brasil inteiro", "All of Brazil");
    case "desconhecida": return L("Local não identificado pela Meta", "Location not identified by Meta");
    case "sem_segmentacao": return L("Sem localidade informada", "No location reported");
  }
}
