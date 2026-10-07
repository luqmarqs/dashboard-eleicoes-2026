import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorBox, Loading } from "../components/ui";
import { Visitas } from "../components/Visitas";
import { acessos, useSouAdmin } from "../lib/acessos";
import { L, locale } from "../lib/i18n";

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
      setAviso(L(`${email.trim().toLowerCase()} incluído. Ele já pode entrar pelo link de acesso.`, `${email.trim().toLowerCase()} added. They can now sign in via the access link.`));
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

  if (admin.isLoading) return <Loading texto={L("Verificando permissões…", "Checking permissions…")} />;
  if (!admin.data) return <ErrorBox error={L("Apenas administradores podem gerenciar os acessos.", "Only administrators can manage access.")} />;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <div className="eyebrow">{L("Administração", "Administration")}</div>
        <h1 className="display text-3xl">{L("Acessos ao painel", "Dashboard access")}</h1>
        <p className="text-muted">
          {L(
            "Só os e-mails desta lista enxergam os dados. Quem for incluído entra pelo link de acesso enviado ao e-mail, sem precisar de senha nem de convite.",
            "Only the emails on this list can see the data. Anyone added signs in via the access link sent to their email, with no password or invitation needed.",
          )}
        </p>
      </header>

      <form className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-5"
        onSubmit={(e) => { e.preventDefault(); setAviso(""); if (email.trim()) incluir.mutate(); }}>
        <h2 className="display text-xl">{L("Incluir e-mail", "Add email")}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label htmlFor="novo-email" className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-muted">{L("E-mail", "Email")}
            <input id="novo-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={L("pessoa@exemplo.org", "person@example.org")} className="rounded-md border border-line bg-bg px-3 py-2 text-ink" />
          </label>
          <label htmlFor="novo-admin" className="flex items-center gap-2 pb-2 text-sm">
            <input id="novo-admin" type="checkbox" checked={comoAdmin} onChange={(e) => setComoAdmin(e.target.checked)} />
            {L("Administrador", "Administrator")}
          </label>
          <button type="submit" disabled={incluir.isPending}
            className="rounded-md bg-accent px-4 py-2 font-semibold text-panel disabled:opacity-50">
            {incluir.isPending ? L("Incluindo…", "Adding…") : L("Incluir", "Add")}
          </button>
        </div>
        <p className="text-xs text-muted">{L("Administradores também podem incluir e remover outros e-mails.", "Administrators can also add and remove other emails.")}</p>
        {incluir.error && <ErrorBox error={incluir.error} />}
        {aviso && <p className="text-sm" role="status">{aviso}</p>}
      </form>

      <section aria-label={L("E-mails autorizados", "Authorized emails")} className="flex flex-col gap-2">
        <h2 className="display text-xl">{L("E-mails autorizados", "Authorized emails")} {lista.data ? `(${lista.data.length})` : ""}</h2>
        {lista.error && <ErrorBox error={lista.error} />}
        {remover.error && <ErrorBox error={remover.error} />}
        {lista.isLoading && <Loading />}
        <ul className="rounded-lg border border-line bg-panel">
          {lista.data?.map((a) => (
            <li key={a.email} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="font-semibold [overflow-wrap:anywhere]">{a.email}</div>
                <div className="text-xs text-muted">
                  {L("incluído em", "added on")} {new Date(a.incluido_em).toLocaleDateString(locale())}
                  {a.incluido_por ? L(` por ${a.incluido_por}`, ` by ${a.incluido_por}`) : ""}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={a.admin} disabled={alternarAdmin.isPending}
                  onChange={(e) => alternarAdmin.mutate({ e: a.email, a: e.target.checked })} />
                admin
              </label>
              {confirmar === a.email ? (
                <span className="flex items-center gap-2 text-sm">
                  {L("Remover?", "Remove?")}
                  <button type="button" className="font-semibold text-danger" onClick={() => { remover.mutate(a.email); setConfirmar(null); }}>{L("Sim", "Yes")}</button>
                  <button type="button" className="text-muted" onClick={() => setConfirmar(null)}>{L("Não", "No")}</button>
                </span>
              ) : (
                <button type="button" className="text-sm text-muted hover:text-danger" onClick={() => setConfirmar(a.email)}>{L("Remover", "Remove")}</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Visitas />
    </div>
  );
}
