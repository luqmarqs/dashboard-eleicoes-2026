import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorBox, Loading } from "../components/ui";
import { acessos, useSouAdmin } from "../lib/acessos";

export function Acessos() {
  const admin = useSouAdmin();
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ["acessos"], queryFn: acessos.listar, enabled: admin.data === true });
  const [email, setEmail] = useState("");
  const [comoAdmin, setComoAdmin] = useState(false);
  const [aviso, setAviso] = useState("");
  const recarregar = () => void qc.invalidateQueries({ queryKey: ["acessos"] });

  const incluir = useMutation({
    mutationFn: () => acessos.adicionar(email, comoAdmin),
    onSuccess: () => {
      setAviso(`${email.trim().toLowerCase()} incluído. Ele já pode entrar pelo link de acesso.`);
      setEmail("");
      setComoAdmin(false);
      recarregar();
    },
  });
  const remover = useMutation({ mutationFn: (e: string) => acessos.remover(e), onSuccess: recarregar });
  const alternarAdmin = useMutation({
    mutationFn: ({ e, a }: { e: string; a: boolean }) => acessos.adicionar(e, a), onSuccess: recarregar,
  });
  const [confirmar, setConfirmar] = useState<string | null>(null);

  if (admin.isLoading) return <Loading texto="Verificando permissões…" />;
  if (!admin.data) return <ErrorBox error="Apenas administradores podem gerenciar os acessos." />;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <div className="eyebrow">Administração</div>
        <h1 className="display text-3xl">Acessos ao painel</h1>
        <p className="text-muted">
          Só os e-mails desta lista enxergam os dados. Quem for incluído entra pelo link de acesso enviado ao e-mail,
          sem precisar de senha nem de convite.
        </p>
      </header>

      <form className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-5"
        onSubmit={(e) => { e.preventDefault(); setAviso(""); if (email.trim()) incluir.mutate(); }}>
        <h2 className="display text-xl">Incluir e-mail</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label htmlFor="novo-email" className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-muted">E-mail
            <input id="novo-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@exemplo.org" className="rounded-md border border-line bg-bg px-3 py-2 text-ink" />
          </label>
          <label htmlFor="novo-admin" className="flex items-center gap-2 pb-2 text-sm">
            <input id="novo-admin" type="checkbox" checked={comoAdmin} onChange={(e) => setComoAdmin(e.target.checked)} />
            Administrador
          </label>
          <button type="submit" disabled={incluir.isPending}
            className="rounded-md bg-accent px-4 py-2 font-semibold text-panel disabled:opacity-50">
            {incluir.isPending ? "Incluindo…" : "Incluir"}
          </button>
        </div>
        <p className="text-xs text-muted">Administradores também podem incluir e remover outros e-mails.</p>
        {incluir.error && <ErrorBox error={incluir.error} />}
        {aviso && <p className="text-sm" role="status">{aviso}</p>}
      </form>

      <section aria-label="E-mails autorizados" className="flex flex-col gap-2">
        <h2 className="display text-xl">E-mails autorizados {lista.data ? `(${lista.data.length})` : ""}</h2>
        {lista.error && <ErrorBox error={lista.error} />}
        {remover.error && <ErrorBox error={remover.error} />}
        {lista.isLoading && <Loading />}
        <ul className="rounded-lg border border-line bg-panel">
          {lista.data?.map((a) => (
            <li key={a.email} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="font-semibold [overflow-wrap:anywhere]">{a.email}</div>
                <div className="text-xs text-muted">
                  incluído em {new Date(a.incluido_em).toLocaleDateString("pt-BR")}
                  {a.incluido_por ? ` por ${a.incluido_por}` : ""}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={a.admin} disabled={alternarAdmin.isPending}
                  onChange={(e) => alternarAdmin.mutate({ e: a.email, a: e.target.checked })} />
                admin
              </label>
              {confirmar === a.email ? (
                <span className="flex items-center gap-2 text-sm">
                  Remover?
                  <button type="button" className="font-semibold text-danger" onClick={() => { remover.mutate(a.email); setConfirmar(null); }}>Sim</button>
                  <button type="button" className="text-muted" onClick={() => setConfirmar(null)}>Não</button>
                </span>
              ) : (
                <button type="button" className="text-sm text-muted hover:text-danger" onClick={() => setConfirmar(a.email)}>Remover</button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
