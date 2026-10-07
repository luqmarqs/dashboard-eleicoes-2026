/**
 * Blocos ideológicos da aba Apocalipse. Padrão explícito e ajustável na própria página (fica salvo no navegador).
 * Esquerda: partidos do campo progressista. Extrema direita: PL (bolsonarismo) e partidos à direita dele no espectro
 * usado pela equipe. Todo o resto fica em "Demais". A escolha é política e aparece declarada na página.
 */
export type Bloco = "esquerda" | "extrema" | "demais";

export const PADRAO: Record<string, Bloco> = {
  PT: "esquerda", PSOL: "esquerda", PCDOB: "esquerda", PV: "esquerda", REDE: "esquerda", PSB: "esquerda", PDT: "esquerda",
  UP: "esquerda", PCB: "esquerda", PSTU: "esquerda", PCO: "esquerda",
  PL: "extrema", NOVO: "extrema", "MISSÃO": "extrema", DC: "extrema",
};

const KEY = "apocalipse-blocos";

export function lerBlocos(): Record<string, Bloco> {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return { ...JSON.parse(s) };
  } catch {
    /* sem armazenamento */
  }
  return { ...PADRAO };
}

export function salvarBlocos(b: Record<string, Bloco>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* ignora */
  }
}

export const blocoDe = (map: Record<string, Bloco>, partido: string | null | undefined): Bloco =>
  map[(partido ?? "").toUpperCase()] ?? "demais";
