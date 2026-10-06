import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { CandidatePanel } from "./pages/CandidatePanel";
import { Comparativo } from "./pages/Comparativo";
import { Dobrada } from "./pages/Dobrada";
import { Metodologia } from "./pages/Metodologia";
import { Overview } from "./pages/Overview";
import { PainelView, Paineis } from "./pages/Paineis";
import { Acessos } from "./pages/Acessos";
import { Presidente } from "./pages/Presidente";
import { useSouAdmin } from "./lib/acessos";
import { isDev } from "./lib/source";
import { supabase } from "./lib/supabase";

const NAV = [
  { to: "/", label: "Visão geral", end: true },
  { to: "/comparativo", label: "Comparativo" },
  { to: "/dobrada", label: "Dobrada" },
  { to: "/presidente", label: "Presidente" },
  { to: "/paineis", label: "Painéis" },
  { to: "/metodologia", label: "Metodologia" },
];

function Shell({ children, onSair }: { children: ReactNode; onSair?: () => void }) {
  const admin = useSouAdmin();
  const nav = admin.data ? [...NAV, { to: "/acessos", label: "Acessos" }] : NAV;
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="display text-lg">Painel Eleitoral <span className="text-accent">SP 2026</span></NavLink>
          <nav aria-label="Principal" className="flex flex-wrap gap-1">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-accent-soft font-semibold text-accent" : "hover:bg-accent-soft"}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {isDev && <span className="rounded bg-accent-soft px-2 py-0.5 text-xs text-accent">dados locais (dev)</span>}
            {onSair && <button type="button" className="text-muted hover:text-ink" onClick={onSair}>Sair</button>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-6">{children}</main>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"idle" | "enviando" | "enviado" | "erro">("idle");
  const [erro, setErro] = useState("");
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEstado("enviando");
    const { error } = await supabase().auth.signInWithOtp({
      // A conta é criada no primeiro acesso; os dados só aparecem para e-mails da lista autorizada (RLS).
      email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
    });
    if (error) {
      setErro(`Não foi possível enviar o link: ${error.message}`);
      setEstado("erro");
    } else setEstado("enviado");
  };
  return (
    <div className="grid min-h-full place-items-center px-4">
      <form onSubmit={enviar} className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-line bg-panel p-6">
        <div className="eyebrow">Acesso restrito à equipe</div>
        <h1 className="display text-2xl">Painel Eleitoral SP 2026</h1>
        {estado === "enviado" ? (
          <p role="status">Enviamos um link de acesso para <b>{email}</b>. Abra o e-mail neste mesmo navegador.</p>
        ) : (
          <>
            <label htmlFor="email" className="flex flex-col gap-1 text-sm text-muted">E-mail
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email" className="rounded-md border border-line bg-bg px-3 py-2 text-ink" />
            </label>
            <button type="submit" disabled={estado === "enviando"}
              className="rounded-md bg-accent px-4 py-2 font-semibold text-panel disabled:opacity-50">
              {estado === "enviando" ? "Enviando…" : "Receber link de acesso"}
            </button>
            {estado === "erro" && <p className="text-sm text-danger" role="alert">{erro}</p>}
          </>
        )}
      </form>
    </div>
  );
}

function Rotas() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/c/:id" element={<CandidatePanel />} />
      <Route path="/comparativo" element={<Comparativo />} />
      <Route path="/dobrada" element={<Dobrada />} />
      <Route path="/presidente" element={<Presidente />} />
      <Route path="/paineis" element={<Paineis />} />
      <Route path="/paineis/:id" element={<PainelView />} />
      <Route path="/metodologia" element={<Metodologia />} />
      <Route path="/acessos" element={<Acessos />} />
      <Route path="*" element={<p className="text-muted">Página não encontrada.</p>} />
    </Routes>
  );
}

function NaoAutorizado({ email, onSair }: { email?: string; onSair: () => void }) {
  return (
    <div className="grid min-h-full place-items-center px-4">
      <div className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-line bg-panel p-6" role="alert">
        <div className="eyebrow">Acesso restrito à equipe</div>
        <h1 className="display text-2xl">E-mail não autorizado</h1>
        <p><b>{email}</b> entrou, mas não está na lista de e-mails autorizados. Peça a um administrador para incluí-lo.</p>
        <button type="button" onClick={onSair} className="rounded-md border border-line px-4 py-2">Sair</button>
      </div>
    </div>
  );
}

function configOk(): string | null {
  if (isDev) return null;
  try {
    supabase();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export default function App() {
  const erroConfig = configOk();
  if (erroConfig) {
    return (
      <div className="grid min-h-full place-items-center px-4">
        <div className="max-w-md rounded-lg border border-danger bg-panel p-6" role="alert">
          <h1 className="display text-2xl">Painel sem configuração</h1>
          <p className="mt-2">{erroConfig}</p>
          <p className="mt-2 text-sm text-muted">Na Vercel: Settings → Environment Variables, e depois um novo deploy.</p>
        </div>
      </div>
    );
  }
  return <AppComSessao />;
}

function AppComSessao() {
  const [session, setSession] = useState<Session | null | undefined>(isDev ? null : undefined);
  const [autorizado, setAutorizado] = useState<boolean | undefined>(isDev ? true : undefined);
  useEffect(() => {
    if (isDev) return;
    void supabase().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (isDev || !session) return;
    setAutorizado(undefined);
    void supabase().rpc("autorizado").then(({ data, error }) => setAutorizado(!error && data === true));
  }, [session]);
  const sair = () => void supabase().auth.signOut();

  return (
    <BrowserRouter>
      {isDev ? (
        <Shell><Rotas /></Shell>
      ) : session === undefined || (session && autorizado === undefined) ? (
        <p className="py-20 text-center text-muted">Verificando acesso…</p>
      ) : session && autorizado ? (
        <Shell onSair={sair}><Rotas /></Shell>
      ) : session ? (
        <NaoAutorizado email={session.user.email} onSair={sair} />
      ) : (
        <Login />
      )}
    </BrowserRouter>
  );
}
