const nf = new Intl.NumberFormat("pt-BR");

export const fmt = (n: number) => nf.format(Math.round(n));

const pf = new Map<number, Intl.NumberFormat>();
export const pct = (x: number, digits = 2) => {
  if (!Number.isFinite(x)) return "–";
  let f = pf.get(digits);
  if (!f) {
    f = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    pf.set(digits, f);
  }
  return f.format(x * 100) + "%";
};

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
