const nf = new Intl.NumberFormat("pt-BR");

export const fmt = (n: number) => nf.format(Math.round(n));

export const pct = (x: number, digits = 2) =>
  Number.isFinite(x)
    ? (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "%"
    : "–";

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
