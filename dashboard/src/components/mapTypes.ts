import type { RGB } from "../lib/colors";
import { L } from "../lib/i18n";

export type Modo = "escolas" | "territorios" | "municipios" | "hexagonos" | "calor";
export type Metrica = "pct" | "votos";

/** Modos do mapa com rótulos no idioma atual (função: avaliada na renderização). */
export const MODOS = (): { id: Modo; label: string; ajuda: string }[] => [
  { id: "escolas", label: L("Escolas", "Polling places"), ajuda: L("Um círculo por local de votação: tamanho = votos, cor = métrica escolhida.", "One circle per polling place: size = votes, color = chosen metric.") },
  { id: "territorios", label: L("Territórios", "Territories"), ajuda: L("Área mais próxima de cada local de votação (só com um município selecionado).", "Area closest to each polling place (only with a city selected).") },
  { id: "municipios", label: L("Municípios", "Cities"), ajuda: L("Cada município pintado pela métrica escolhida. Clique para entrar no município.", "Each city colored by the chosen metric. Click to open the city.") },
  { id: "hexagonos", label: L("Hexágonos", "Hexagons"), ajuda: L("Locais agregados em hexágonos de tamanho fixo.", "Polling places aggregated into fixed-size hexagons.") },
  { id: "calor", label: L("Calor", "Heat map"), ajuda: L("Densidade de votos, sem fronteiras.", "Vote density, without boundaries.") },
];

export interface Destaque {
  rank: number;
  nome: string;
  lat: number;
  lon: number;
}

/** Bivariado: quando informado, a cor de cada local vem daqui (modo dobrada). */
export type CorPorLocal = (idx: number) => RGB | null;
