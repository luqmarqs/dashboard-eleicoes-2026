import { locale } from "./i18n";

// Formatadores por idioma (pt-BR: 1.234,5 · en-US: 1,234.5)
const cache = new Map<string, Intl.NumberFormat>();
function nf(chave: string, opcoes?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = `${locale()}|${chave}`;
  let f = cache.get(k);
  if (!f) { f = new Intl.NumberFormat(locale(), opcoes); cache.set(k, f); }
  return f;
}

export const fmt = (n: number) => nf("int").format(Math.round(n));

export const pct = (x: number, digits = 2) => {
  if (!Number.isFinite(x)) return "–";
  return nf(`pct${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x * 100) + "%";
};

/** Número com casas decimais no idioma atual. */
export const dec = (x: number, digits = 2) =>
  nf(`dec${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x);

const MINUSCULAS = new Set(["da", "das", "de", "do", "dos", "e"]);

/** "SÃO JOSÉ DOS CAMPOS" -> "São José dos Campos" */
export function titulo(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-|\()/)
    .map((w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
