import { createContext, useContext, useState, type ReactNode } from "react";

export interface InfoUf {
  sigla: string;
  nome: string;
  /** Código TSE da capital. */
  capital: string;
}

export const UFS: InfoUf[] = [
  { sigla: "SP", nome: "São Paulo", capital: "71072" },
  { sigla: "MG", nome: "Minas Gerais", capital: "41238" },
];

const KEY = "uf-selecionada";
let atual = lerSalva();

function lerSalva(): string {
  // ?uf=MG no endereço escolhe o estado (links diretos); senão, a última escolha deste navegador.
  const daUrl = new URLSearchParams(window.location.search).get("uf")?.toUpperCase();
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
