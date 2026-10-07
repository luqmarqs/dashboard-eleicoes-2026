import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { UFS, useUf } from "./lib/uf";
import { CandidatePanel } from "./pages/CandidatePanel";
import { Comparativo } from "./pages/Comparativo";
import { Dobrada } from "./pages/Dobrada";
import { Metodologia } from "./pages/Metodologia";
import { Overview } from "./pages/Overview";
import { PainelView, Paineis } from "./pages/Paineis";
import { Acessos } from "./pages/Acessos";
import { Presidente } from "./pages/Presidente";
import { Publicidade } from "./pages/Publicidade";
import { useSouAdmin } from "./lib/acessos";
import { isDev } from "./lib/source";
import { supabase } from "./lib/supabase";

const NAV = [
  { to: "/", label: "Visão geral", end: true },
  { to: "/comparativo", label: "Comparativo" },
  { to: "/dobrada", label: "Dobrada" },
  { to: "/presidente", label: "Presidente" },
  { to: "/publicidade", label: "Publicidade" },
  { to: "/paineis", label: "Painéis" },
  { to: "/metodologia", label: "Metodologia" },
];

function SeletorUf() {
  const { uf, setUf } = useUf();
  const navigate = useNavigate();
  if (UFS.length < 2) return null;
  return (
    <div role="radiogroup" aria-label="Estado" className="inline-flex rounded-md border border-line p-0.5">
      {UFS.map((u) => (
        <button key={u.sigla} type="button" role="radio" aria-checked={uf === u.sigla} title={u.nome}
          onClick={() => { if (u.sigla !== uf) { setUf(u.sigla); navigate("/"); } }}
          className={`rounded px-2.5 py-1 text-sm font-bold ${uf === u.sigla ? "bg-accent text-panel" : "hover:bg-accent-soft"}`}>
          {u.sigla}
        </button>
      ))}
    </div>
  );
}

function Shell({ children, onSair }: { children: ReactNode; onSair?: () => void }) {
  const admin = useSouAdmin();
  const { uf } = useUf();
  const nav = admin.data ? [...NAV, { to: "/acessos", label: "Acessos" }] : NAV;
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <NavLink to="/" className="display text-lg">Painel Eleitoral <span className="text-accent">{uf} 2026</span></NavLink>
            <SeletorUf />
          </div>
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
      <main key={uf} className="mx-auto max-w-[1500px] px-4 py-6">{children}</main>
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
      setErro(/rate limit/i.test(error.message)
        ? "Muitos pedidos de link agora. Espere alguns minutos e tente de novo; se você já recebeu um link antes, use o mais recente."
        : `Não foi possível enviar o link: ${error.message}`);
      setEstado("erro");
    } else setEstado("enviado");
  };
  const google = async () => {
    setErro("");
    // O acesso continua limitado aos e-mails da lista autorizada (RLS), qualquer que seja o login.
    const { error } = await supabase().auth.signInWithOAuth({
      provider: "google", options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) { setErro(`Não foi possível entrar com o Google: ${error.message}`); setEstado("erro"); }
  };
  return (
    <div className="grid min-h-full place-items-center px-4">
      <form onSubmit={enviar} className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-line bg-panel p-6">
        <div className="eyebrow">Acesso restrito à equipe</div>
        <h1 className="display text-2xl">Painel Eleitoral 2026</h1>
        {estado === "enviado" ? (
          <p role="status">Enviamos um link de acesso para <b>{email}</b>. Abra o e-mail neste mesmo navegador.</p>
        ) : (
          <>
            <button type="button" onClick={() => void google()}
              className="flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 font-semibold text-panel">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden className="rounded-sm bg-white p-0.5">
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
                <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
                <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
                <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
              </svg>
              Entrar com Google
            </button>
            <div className="flex items-center gap-2 text-xs text-muted" aria-hidden>
              <span className="h-px flex-1 bg-line" />ou receba um link por e-mail<span className="h-px flex-1 bg-line" />
            </div>
            <label htmlFor="email" className="flex flex-col gap-1 text-sm text-muted">E-mail
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email" className="rounded-md border border-line bg-bg px-3 py-2 text-ink" />
            </label>
            <button type="submit" disabled={estado === "enviando"}
              className="rounded-md border border-line px-4 py-2 font-semibold hover:bg-accent-soft disabled:opacity-50">
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
      <Route path="/publicidade" element={<Publicidade />} />
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
    const { data } = supabase().auth.onAuthStateChange((_e, s) =>
      // mantém o mesmo objeto se o usuário não mudou (evita re-renderizar tudo a cada revalidação)
      setSession((prev) => (prev && s && prev.user.id === s.user.id ? prev : s)));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (isDev || !session) return;
    // Só checa de novo quando o usuário muda. Ao voltar para a aba o Supabase revalida o token e emite
    // uma sessão nova do mesmo usuário; resetar aqui fazia a tela inteira piscar e remontar.
    void supabase().rpc("autorizado").then(({ data, error }) => setAutorizado(!error && data === true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);
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
