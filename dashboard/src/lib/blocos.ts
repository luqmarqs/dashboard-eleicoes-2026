/**
 * Blocos ideológicos da aba Apocalipse. Padrão explícito e ajustável na própria página (fica salvo no navegador).
 * Esquerda: partidos do campo progressista. Extrema direita: PL (bolsonarismo) e partidos à direita dele no espectro
 * usado pela equipe. Centrão: partidos fisiológicos de centro e centro-direita, conforme o survey com cientistas políticos
 * de Testa, Mesquita & Bolognesi (Cadernos CRH, 2024; ABCP, 2022), com os sucessores atuais (PRD = PTB + Patriota;
 * União = DEM + PSL) e as legendas menores do mesmo perfil. O survey também põe o PL no centrão; aqui ele fica na
 * extrema direita (escolha declarada na página). Todo o resto fica em "Demais".
 */
export type Bloco = "esquerda" | "centrao" | "extrema" | "demais";

export const BLOCOS: Bloco[] = ["esquerda", "centrao", "extrema", "demais"];
export const zeroPorBloco = (): Record<Bloco, number> => ({ esquerda: 0, centrao: 0, extrema: 0, demais: 0 });

export const PADRAO: Record<string, Bloco> = {
  PT: "esquerda", PSOL: "esquerda", PCDOB: "esquerda", PV: "esquerda", REDE: "esquerda", PSB: "esquerda", PDT: "esquerda",
  UP: "esquerda", PCB: "esquerda", PSTU: "esquerda", PCO: "esquerda",
  PP: "centrao", REPUBLICANOS: "centrao", "UNIÃO": "centrao", MDB: "centrao", PSD: "centrao", PODE: "centrao", PRD: "centrao",
  SOLIDARIEDADE: "centrao", AVANTE: "centrao", AGIR: "centrao", MOBILIZA: "centrao",
  PL: "extrema", NOVO: "extrema", "MISSÃO": "extrema", DC: "extrema",
};

// v2: a classificação ganhou o centrão; escolhas salvas na versão anterior não valem mais
const KEY = "apocalipse-blocos-v2";

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
