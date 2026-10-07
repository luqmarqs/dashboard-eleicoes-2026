import { useQuery } from "@tanstack/react-query";
import { isDev } from "./source";
import { supabase } from "./supabase";

/*
 * Log de visitas: a cada rota aberta por um e-mail autorizado, registra rota (sem query string), UF, idioma, tipo de
 * aparelho e um id de sessão por aba. Sem IP e sem user agent completo. Só o DONO lê (página Acessos): a regra vale no
 * banco (dono_visitas); aqui é só para esconder a seção dos demais.
 */

/** Único e-mail que vê o log; o mesmo da função dono_visitas() no banco. */
export const DONO_VISITAS = "luq.marqs@gmail.com";

export interface VisitaUsuario { email: string; admin: boolean; visitas: number; sessoes: number; dias_ativos: number; primeira: string | null; ultima: string | null; rotas: number }
export interface VisitasResumo {
  desde: string;
  totais: { visitas: number; usuarios: number; sessoes: number };
  por_usuario: VisitaUsuario[];
  por_rota: { rota: string; visitas: number; usuarios: number }[];
  por_dia: { dia: string; visitas: number; usuarios: number }[];
  ultimas: { email: string; visto_em: string; rota: string; uf: string | null; lang: string | null; dispositivo: string | null }[];
}

const sessao = (): string => {
  try {
    let s = sessionStorage.getItem("visita-sessao");
    if (!s) {
      s = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      sessionStorage.setItem("visita-sessao", s);
    }
    return s;
  } catch {
    return "sem-sessao";
  }
};
const dispositivo = (): string => {
  const uad = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  const mobile = uad?.mobile ?? /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  return mobile ? "celular" : "desktop";
};

let ultimaChave = "";
let ultimaEm = 0;
/** Registra a visita (uma por rota/UF/idioma a cada 30 s, para não contar re-renderizações). Nunca lança erro. */
export function registrarVisita(rota: string, uf: string, lang: string): void {
  if (isDev) return;
  const k = `${rota}|${uf}|${lang}`;
  const agora = Date.now();
  if (k === ultimaChave && agora - ultimaEm < 30_000) return;
  ultimaChave = k;
  ultimaEm = agora;
  void supabase().rpc("registrar_visita", { p_rota: rota, p_uf: uf, p_lang: lang, p_dispositivo: dispositivo(), p_sessao: sessao() })
    .then(({ error }) => { if (error) console.warn("visita não registrada:", error.message); });
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// Em dev-data não há Supabase: um exemplo pequeno e marcado como tal, só para enxergar a tela.
function exemploDev(dias: number): VisitasResumo {
  const agora = Date.now(), d = (h: number) => new Date(agora - h * 3600_000).toISOString();
  return {
    desde: new Date(agora - dias * 86400_000).toISOString(),
    totais: { visitas: 7, usuarios: 2, sessoes: 3 },
    por_usuario: [
      { email: "exemplo@equipe.org", admin: true, visitas: 5, sessoes: 2, dias_ativos: 2, primeira: d(30), ultima: d(1), rotas: 4 },
      { email: "outra@equipe.org", admin: false, visitas: 2, sessoes: 1, dias_ativos: 1, primeira: d(50), ultima: d(50), rotas: 2 },
      { email: "nunca@equipe.org", admin: false, visitas: 0, sessoes: 0, dias_ativos: 0, primeira: null, ultima: null, rotas: 0 },
    ],
    por_rota: [{ rota: "/", visitas: 3, usuarios: 2 }, { rota: "/apocalipse", visitas: 2, usuarios: 1 }, { rota: "/c/895", visitas: 2, usuarios: 2 }],
    por_dia: [{ dia: d(50).slice(0, 10), visitas: 2, usuarios: 1 }, { dia: d(1).slice(0, 10), visitas: 5, usuarios: 2 }],
    ultimas: [
      { email: "exemplo@equipe.org", visto_em: d(1), rota: "/apocalipse", uf: "SP", lang: "pt", dispositivo: "desktop" },
      { email: "exemplo@equipe.org", visto_em: d(1.1), rota: "/", uf: "SP", lang: "pt", dispositivo: "desktop" },
      { email: "outra@equipe.org", visto_em: d(50), rota: "/c/895", uf: "SP", lang: "en", dispositivo: "celular" },
    ],
  };
}

export const visitas = {
  resumo: (dias: number) => (isDev ? Promise.resolve(exemploDev(dias)) : rpc<VisitasResumo>("visitas_resumo", { p_dias: dias })),
  limpar: (dias: number) => (isDev ? Promise.resolve(0) : rpc<number>("visitas_limpar", { p_dias: dias })),
};

/** Se quem está logado é o dono do log (em dev-data, sim, para enxergar a tela). */
export function useDonoVisitas() {
  return useQuery({
    queryKey: ["dono-visitas"], staleTime: 60_000,
    queryFn: async () => (isDev ? true : rpc<boolean>("dono_visitas")),
  });
}

export function useVisitas(dias: number, ativo: boolean) {
  return useQuery({ queryKey: ["visitas", dias], queryFn: () => visitas.resumo(dias), enabled: ativo, staleTime: 60_000 });
}
