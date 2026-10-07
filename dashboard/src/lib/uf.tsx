import { createContext, useContext, useState, type ReactNode } from "react";

export interface InfoUf {
  sigla: string;
  nome: string;
  /** Código TSE da capital. */
  capital: string;
  /** Artigo para "em"/"de": "no Rio Grande do Sul", "de São Paulo". */
  artigo?: "o";
}

/** "em São Paulo" / "no Rio Grande do Sul"; "de São Paulo" / "do Rio Grande do Sul". */
export const emUf = (u: InfoUf) => `${u.artigo ? "no" : "em"} ${u.nome}`;
export const deUf = (u: InfoUf) => `${u.artigo ? "do" : "de"} ${u.nome}`;

export const UFS: InfoUf[] = [
  { sigla: "SP", nome: "São Paulo", capital: "71072" },
  { sigla: "MG", nome: "Minas Gerais", capital: "41238" },
  { sigla: "RS", nome: "Rio Grande do Sul", capital: "88013", artigo: "o" },
];

const KEY = "uf-selecionada";
let atual = lerSalva();

/**
 * UF de uma candidatura pelo id: as cargas usam faixas de 100 mil ids por UF, na ordem de UFS
 * (SP 0–99.999, MG 100.000–199.999, RS 200.000–…), igual a UF_ORDEM em scripts/export_dashboard.py.
 */
export function ufDaCandidatura(id: number): string | undefined {
  return Number.isFinite(id) && id > 0 ? UFS[Math.floor(id / 100_000)]?.sigla : undefined;
}

/** Links com candidatura (/c/123, ?a=123) abrem no estado certo mesmo sem ?uf=. */
function ufDoEndereco(): string | undefined {
  const q = new URLSearchParams(window.location.search);
  const doParam = q.get("uf")?.toUpperCase();
  if (doParam) return doParam;
  const m = window.location.pathname.match(/^\/c\/(\d+)/);
  const id = Number(m?.[1] ?? q.get("a") ?? q.get("b") ?? NaN);
  return ufDaCandidatura(id);
}

function lerSalva(): string {
  // ?uf=MG (ou a candidatura no endereço) escolhe o estado; senão, a última escolha deste navegador.
  const daUrl = ufDoEndereco();
  if (daUrl && UFS.some((u) => u.sigla === daUrl)) {
    try {
      localStorage.setItem(KEY, daUrl);
    } catch {
      /* ignora */
    }
    return daUrl;
  }
  try {
    const s = localStorage.getItem(KEY);
    if (s && UFS.some((u) => u.sigla === s)) return s;
  } catch {
    /* sem armazenamento */
  }
  return UFS[0].sigla;
}

/** UF atual (lida pelas funções de dados fora do React). */
export const getUf = () => atual;
export const infoUf = (sigla: string) => UFS.find((u) => u.sigla === sigla) ?? UFS[0];

const Ctx = createContext<{ uf: string; info: InfoUf; setUf: (s: string) => void }>({
  uf: atual, info: infoUf(atual), setUf: () => {},
});

export function UfProvider({ children }: { children: ReactNode }) {
  const [uf, set] = useState(atual);
  const setUf = (s: string) => {
    atual = s;
    try {
      localStorage.setItem(KEY, s);
    } catch {
      /* ignora */
    }
    set(s);
  };
  return <Ctx.Provider value={{ uf, info: infoUf(uf), setUf }}>{children}</Ctx.Provider>;
}

export const useUf = () => useContext(Ctx);
