import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DataTable, TituloTabela } from "../components/DataTable";
import { ErrorBox, Loading, Segmented, Stat } from "../components/ui";
import type { ExportCol } from "../lib/export";
import { fmt } from "../lib/format";
import { L, locale } from "../lib/i18n";
import { isDev } from "../lib/source";
import { DONO_VISITAS, useDonoVisitas, useVisitas, visitas, type VisitaUsuario, type VisitasResumo } from "../lib/visitas";

/** Seção "Visitas" da página Acessos, visível só para DONO_VISITAS (regra garantida no banco): quem entrou, quando, onde. */
export function Visitas() {
  const dono = useDonoVisitas();
  const [dias, setDias] = useState(30);
  const q = useVisitas(dias, dono.data === true);
  const qc = useQueryClient();
  const [confirmar, setConfirmar] = useState(false);
  const limpar = useMutation({ mutationFn: () => visitas.limpar(180), onSuccess: () => { setConfirmar(false); void qc.invalidateQueries({ queryKey: ["visitas"] }); } });
  const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) : L("nunca", "never"));

  const colUsuarios = useMemo<ColumnDef<VisitaUsuario, unknown>[]>(() => [
    { id: "email", accessorKey: "email", header: L("E-mail", "Email"), cell: (x) => <span className="font-semibold [overflow-wrap:anywhere]">{String(x.getValue())}{x.row.original.admin ? <span className="ml-1 text-xs font-normal text-muted">admin</span> : null}</span> },
    { id: "ultima", accessorKey: "ultima", header: L("Última visita", "Last visit"), cell: (x) => dt(x.getValue() as string | null), sortUndefined: "last" },
    { id: "visitas", accessorKey: "visitas", header: L("Visitas no período", "Visits in period"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "sessoes", accessorKey: "sessoes", header: L("Sessões", "Sessions"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "dias_ativos", accessorKey: "dias_ativos", header: L("Dias ativos", "Active days"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "rotas", accessorKey: "rotas", header: L("Páginas distintas", "Distinct pages"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
  ], []);
  const expUsuarios: ExportCol<VisitaUsuario>[] = [
    { header: L("E-mail", "Email"), value: (l) => l.email }, { header: "Admin", value: (l) => (l.admin ? L("sim", "yes") : L("não", "no")) },
    { header: L("Última visita", "Last visit"), value: (l) => l.ultima ?? "" }, { header: L("Visitas no período", "Visits in period"), value: (l) => l.visitas, type: "number" },
    { header: L("Sessões", "Sessions"), value: (l) => l.sessoes, type: "number" }, { header: L("Dias ativos", "Active days"), value: (l) => l.dias_ativos, type: "number" },
    { header: L("Páginas distintas", "Distinct pages"), value: (l) => l.rotas, type: "number" },
  ];
  type Ultima = VisitasResumo["ultimas"][number];
  const colUltimas = useMemo<ColumnDef<Ultima, unknown>[]>(() => [
    { id: "visto_em", accessorKey: "visto_em", header: L("Quando", "When"), cell: (x) => dt(String(x.getValue())) },
    { id: "email", accessorKey: "email", header: L("E-mail", "Email"), cell: (x) => <span className="[overflow-wrap:anywhere]">{String(x.getValue())}</span> },
    { id: "rota", accessorKey: "rota", header: L("Página", "Page"), cell: (x) => <code className="text-xs">{String(x.getValue())}</code> },
    { id: "uf", accessorKey: "uf", header: "UF" },
    { id: "lang", accessorKey: "lang", header: L("Idioma", "Language") },
    { id: "dispositivo", accessorKey: "dispositivo", header: L("Aparelho", "Device") },
  ], []);
  const expUltimas: ExportCol<Ultima>[] = [
    { header: L("Quando", "When"), value: (l) => l.visto_em }, { header: L("E-mail", "Email"), value: (l) => l.email }, { header: L("Página", "Page"), value: (l) => l.rota },
    { header: "UF", value: (l) => l.uf ?? "" }, { header: L("Idioma", "Language"), value: (l) => l.lang ?? "" }, { header: L("Aparelho", "Device"), value: (l) => l.dispositivo ?? "" },
  ];
  type Rota = VisitasResumo["por_rota"][number];
  const colRotas = useMemo<ColumnDef<Rota, unknown>[]>(() => [
    { id: "rota", accessorKey: "rota", header: L("Página", "Page"), cell: (x) => <code className="text-xs">{String(x.getValue())}</code> },
    { id: "visitas", accessorKey: "visitas", header: L("Visitas", "Visits"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
    { id: "usuarios", accessorKey: "usuarios", header: L("Usuários", "Users"), cell: (x) => fmt(Number(x.getValue())), meta: { numeric: true } },
  ], []);
  const expRotas: ExportCol<Rota>[] = [
    { header: L("Página", "Page"), value: (l) => l.rota }, { header: L("Visitas", "Visits"), value: (l) => l.visitas, type: "number" }, { header: L("Usuários", "Users"), value: (l) => l.usuarios, type: "number" },
  ];

  const r = q.data;
  const semVisita = r?.por_usuario.filter((u) => !u.ultima).length ?? 0;
  const maxDia = Math.max(1, ...(r?.por_dia.map((d) => d.visitas) ?? [1]));
  if (dono.data !== true) return null;
  return (
    <section aria-label={L("Visitas", "Visits")} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="display text-xl">{L("Visitas ao painel", "Dashboard visits")}</h2>
        <Segmented label={L("Período", "Period")} value={String(dias)} onChange={(v) => setDias(Number(v))}
          options={[{ id: "7", label: L("7 dias", "7 days") }, { id: "30", label: L("30 dias", "30 days") }, { id: "90", label: L("90 dias", "90 days") }]} />
      </div>
      <p className="text-sm text-muted">
        {L(`Cada página aberta por um e-mail autorizado gera um registro: e-mail, horário, página, estado, idioma e tipo de aparelho (celular ou desktop). Não guardamos IP nem o navegador completo. Só ${DONO_VISITAS} vê esta seção.`,
          `Every page opened by an authorized email creates a record: email, time, page, state, language and device type (mobile or desktop). No IP address or full browser string is stored. Only ${DONO_VISITAS} sees this section.`)}
        {isDev && <b> {L("Modo dev: dados de exemplo.", "Dev mode: sample data.")}</b>}
      </p>
      {q.error && <ErrorBox error={q.error} />}
      {q.isLoading && <Loading />}
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat valor={fmt(r.totais.visitas)} rotulo={L("páginas abertas", "pages opened")} />
            <Stat valor={fmt(r.totais.usuarios)} rotulo={L("pessoas que entraram", "people who signed in")} />
            <Stat valor={fmt(r.totais.sessoes)} rotulo={L("sessões (abas)", "sessions (tabs)")} />
            <Stat valor={fmt(semVisita)} rotulo={L("autorizados que nunca entraram", "authorized, never signed in")} />
          </div>
          {r.por_dia.length > 0 && (
            <div className="rounded-lg border border-line bg-panel p-3">
              <TituloTabela>{L("Páginas abertas por dia", "Pages opened per day")}</TituloTabela>
              <div className="mt-2 flex h-20 items-end gap-px" aria-hidden>
                {r.por_dia.map((d) => (
                  <span key={d.dia} title={`${new Date(d.dia + "T12:00:00").toLocaleDateString(locale())}: ${fmt(d.visitas)} ${L("páginas", "pages")}, ${fmt(d.usuarios)} ${L("pessoas", "people")}`}
                    className="flex-1 rounded-t-sm bg-accent" style={{ height: `${Math.max(4, (d.visitas / maxDia) * 100)}%` }} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted">
                <span>{new Date(r.por_dia[0].dia + "T12:00:00").toLocaleDateString(locale())}</span>
                <span>{new Date(r.por_dia[r.por_dia.length - 1].dia + "T12:00:00").toLocaleDateString(locale())}</span>
              </div>
            </div>
          )}
          <DataTable titulo={L(`Por pessoa (todos os e-mails autorizados; atividade nos últimos ${dias} dias)`, `By person (all authorized emails; activity in the last ${dias} days)`)}
            data={r.por_usuario} columns={colUsuarios} exportCols={expUsuarios} nomeArquivo="visitas_por_pessoa" busca={(l) => l.email}
            initialSort={[{ id: "ultima", desc: true }]} pageSize={15}
            atalhos={[
              { label: L("Mais recentes", "Most recent"), sort: [{ id: "ultima", desc: true }] },
              { label: L("Mais ativos", "Most active"), sort: [{ id: "visitas", desc: true }] },
              { label: L("Nunca entraram", "Never signed in"), sort: [{ id: "ultima", desc: false }] },
            ]} />
          <div className="grid gap-4 lg:grid-cols-2">
            <DataTable titulo={L("Páginas mais abertas", "Most opened pages")} data={r.por_rota} columns={colRotas} exportCols={expRotas}
              nomeArquivo="visitas_por_pagina" busca={(l) => l.rota} initialSort={[{ id: "visitas", desc: true }]} pageSize={10} />
            <DataTable titulo={L("Últimas visitas (até 300)", "Latest visits (up to 300)")} data={r.ultimas} columns={colUltimas} exportCols={expUltimas}
              nomeArquivo="visitas_ultimas" busca={(l) => `${l.email} ${l.rota}`} initialSort={[{ id: "visto_em", desc: true }]} pageSize={10} />
          </div>
          <p className="text-xs text-muted">
            {L("Retenção: os registros ficam até você apagar. ", "Retention: records stay until you delete them. ")}
            {confirmar ? (
              <>
                {L("Apagar registros com mais de 180 dias?", "Delete records older than 180 days?")}{" "}
                <button type="button" className="font-semibold text-danger" onClick={() => limpar.mutate()} disabled={limpar.isPending}>{L("Sim", "Yes")}</button>{" "}
                <button type="button" onClick={() => setConfirmar(false)}>{L("Não", "No")}</button>
              </>
            ) : (
              <button type="button" className="text-accent" onClick={() => setConfirmar(true)}>{L("Apagar registros com mais de 180 dias", "Delete records older than 180 days")}</button>
            )}
            {limpar.data != null && <> {L(`${fmt(limpar.data)} registros apagados.`, `${fmt(limpar.data)} records deleted.`)}</>}
            {limpar.error && <ErrorBox error={limpar.error} />}
          </p>
        </>
      )}
    </section>
  );
}
