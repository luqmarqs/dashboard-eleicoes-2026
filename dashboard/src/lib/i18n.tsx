import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Idioma da interface (português | inglês). Uso: L("Votos", "Votes") em qualquer lugar.
 * O idioma vive num módulo (como a UF) para funções fora do React (formatação, rótulos); trocar o idioma
 * remonta a página (key no <main>), então todo L() é reavaliado.
 */
export type Lang = "pt" | "en";
const KEY = "idioma";

function ler(): Lang {
  const q = new URLSearchParams(window.location.search).get("lang");
  if (q === "en" || q === "pt") return q;
  try {
    const s = localStorage.getItem(KEY);
    if (s === "en" || s === "pt") return s;
  } catch {
    /* sem armazenamento */
  }
  return "pt";
}

let atual: Lang = ler();
document.documentElement.lang = atual === "en" ? "en" : "pt-BR";

export const getLang = () => atual;
/** Texto no idioma atual. */
export const L = (pt: string, en: string) => (atual === "en" ? en : pt);
/** Locale para Intl (números e datas). */
export const locale = () => (atual === "en" ? "en-US" : "pt-BR");

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: atual, setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(atual);
  const setLang = (l: Lang) => {
    atual = l;
    document.documentElement.lang = l === "en" ? "en" : "pt-BR";
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignora */
    }
    set(l);
  };
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);

export function SeletorIdioma() {
  const { lang, setLang } = useLang();
  return (
    <div role="radiogroup" aria-label={L("Idioma", "Language")} className="inline-flex rounded-md border border-line p-0.5">
      {(["pt", "en"] as Lang[]).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={lang === l} title={l === "pt" ? "Português" : "English"}
          onClick={() => setLang(l)}
          className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${lang === l ? "bg-accent text-panel" : "hover:bg-accent-soft"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}
