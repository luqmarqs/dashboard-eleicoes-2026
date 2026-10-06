/**
 * Escalas de cor. Magnitude = um só tom (roxo), do claro ao escuro; no tema escuro, do escuro ao
 * claro. Nunca arco-íris. A dobrada usa uma matriz bivariada 3×3 (roxo × verde-azulado).
 */
export type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export const RAMP_LIGHT = ["#f1e6f8", "#dcc0ee", "#c597e2", "#a96bd2", "#8a43bb", "#6a2399", "#470c6e"].map(hex);
export const RAMP_DARK = ["#3a1752", "#55227a", "#7433a2", "#9450c4", "#b37ad9", "#d1a8ea", "#efdcfa"].map(hex);

export const prefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
export const ramp = () => (prefersDark() ? RAMP_DARK : RAMP_LIGHT);

/** Quebras por quantis (ignora zeros) para n classes. */
export function quantis(values: ArrayLike<number>, n = 7): number[] {
  const nz = Array.from(values).filter((v) => v > 0).sort((a, b) => a - b);
  if (!nz.length) return [];
  const out: number[] = [];
  for (let i = 1; i < n; i++) out.push(nz[Math.min(nz.length - 1, Math.floor((nz.length * i) / n))]);
  return out;
}

export function classe(v: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && v > breaks[i]) i++;
  return i;
}

export function corSequencial(v: number, breaks: number[], alpha = 230): [number, number, number, number] {
  const r = ramp();
  const c = r[Math.min(classe(v, breaks), r.length - 1)];
  return [c[0], c[1], c[2], alpha];
}

// Matriz bivariada (Stevens): eixo A em roxo, eixo B em verde-azulado; [a][b], 0 = baixo, 2 = alto.
export const BIVAR: RGB[][] = [
  ["#e8e8e8", "#ace4e4", "#5ac8c8"],
  ["#dfb0d6", "#a5add3", "#5698b9"],
  ["#be64ac", "#8c62aa", "#3b4994"],
].map((row) => row.map(hex));

export const cssRgb = (c: RGB) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
