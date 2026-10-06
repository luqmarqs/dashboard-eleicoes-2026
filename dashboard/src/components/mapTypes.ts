import type { RGB } from "../lib/colors";

export type Modo = "escolas" | "territorios" | "municipios" | "hexagonos" | "calor";
export type Metrica = "pct" | "votos";

export const MODOS: { id: Modo; label: string; ajuda: string }[] = [
  { id: "escolas", label: "Escolas", ajuda: "Um círculo por local de votação: tamanho = votos, cor = métrica escolhida." },
  { id: "territorios", label: "Territórios", ajuda: "Área mais próxima de cada local de votação (só com um município selecionado)." },
  { id: "municipios", label: "Municípios", ajuda: "Cada município pintado pela métrica escolhida. Clique para entrar no município." },
  { id: "hexagonos", label: "Hexágonos", ajuda: "Locais agregados em hexágonos de tamanho fixo." },
  { id: "calor", label: "Calor", ajuda: "Densidade de votos, sem fronteiras." },
];

export interface Destaque {
  rank: number;
  nome: string;
  lat: number;
  lon: number;
}

/** Bivariado: quando informado, a cor de cada local vem daqui (modo dobrada). */
export type CorPorLocal = (idx: number) => RGB | null;
