import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DataTable, TituloTabela } from "../components/DataTable";
import { ErrorBox, Loading, Segmented, SituacaoBadge, Stat, nomeCand, situacaoTexto } from "../components/ui";
import { useBase, type Base } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { dec, fmt, pct, titulo } from "../lib/format";
import { L, getLang } from "../lib/i18n";
import { fmtData, fmtDataHora, mediana } from "../lib/meta";
import { source, type Digital, type DigitalObs, type DigitalPerfil } from "../lib/source";
import { CARGOS, type Candidatura } from "../lib/types";
import { useUf } from "../lib/uf";

/*
 * Evolução digital × votação (MG). Regras de leitura:
 * - só pontos observados; sem curva diária inventada; plataformas separadas; seguidores não são eleitores nem votos;
 * - comparação só entre perfis com observação nas duas datas escolhidas (mesma janela);
 * - ganho % com base zero é indefinido; dado ausente fica "–" (nunca zero);
 * - o snapshot atual é posterior à eleição (04/10/2026): a variação até ele não é só de campanha.
 */

const ELEICAO = "2026-10-04";
const PLATAFORMAS: Record<string, string> = { instagram: "Instagram", x: "X" }; // nomes próprios: iguais nos dois idiomas

function useDigital() {
  const { uf } = useUf();
  return useQuery({ queryKey: ["digital", uf], queryFn: () => source.digital(), staleTime: 5 * 60_000 });
}

/** Uma observação por perfil e dia: a de instante conhecido e mais tardia no dia; ignora falhas (sem valor). */
function porDia(obs: DigitalObs[]): Map<string, Map<string, DigitalObs>> {
  const m = new Map<string, Map<string, DigitalObs>>();
  for (const o of obs) {
    if (!o.data || o.seguidores == null) continue;
    const d = m.get(o.perfil_key) ?? new Map<string, DigitalObs>();
    const atual = d.get(o.data);
    if (!atual || (o.observado_em && (!atual.observado_em || o.observado_em > atual.observado_em))) d.set(o.data, o);
    m.set(o.perfil_key, d);
  }
  return m;
}

const sinal = (x: number) => (x > 0 ? "+" : "");
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
/** Posição ordinal: "3º" | "#3". */
const ordinal = (n: unknown) => L(`${n}º`, `#${n}`);

interface Linha {
  perfil: DigitalPerfil;
  cand?: Candidatura;
  ini: DigitalObs | null;
  fim: DigitalObs | null;
  ganho: number | null;
  pctGanho: number | null;
  dias: number | null;
  porDia: number | null;
  votos: number | null;
  pctVal: number | null;
  posicao: number | null;
}

export function DigitalMG() {
  const base = useBase();
  const dig = useDigital();
  const { uf } = useUf();
  const [plataforma, setPlataforma] = useState("instagram");
  const [partido, setPartido] = useState("todos");
  const [de, setDe] = useState<string | null>(null);
  const [ate, setAte] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [grafico, setGrafico] = useState<"abs" | "pct">("abs");

  if (uf !== "MG") return <p className="text-muted">{L("Este painel é de Minas Gerais.", "This dashboard covers Minas Gerais.")} <Link className="text-accent" to="/digital-mg?uf=MG">{L("Abrir em MG", "Open for MG")}</Link></p>;
  if (base.error) return <ErrorBox error={base.error} />;
  if (dig.error) return <ErrorBox error={dig.error} />;
  if (!base.data || !dig.data) return <Loading />;
  return <Painel base={base.data} d={dig.data} plataforma={plataforma} setPlataforma={setPlataforma} partido={partido}
    setPartido={setPartido} de={de} setDe={setDe} ate={ate} setAte={setAte} sel={sel} setSel={setSel} grafico={grafico} setGrafico={setGrafico} />;
}

function Painel({ base, d, plataforma, setPlataforma, partido, setPartido, de, setDe, ate, setAte, sel, setSel, grafico, setGrafico }: {
  base: Base; d: Digital; plataforma: string; setPlataforma: (p: string) => void; partido: string; setPartido: (p: string) => void;
  de: string | null; setDe: (s: string | null) => void; ate: string | null; setAte: (s: string | null) => void;
  sel: string | null; setSel: (s: string | null) => void; grafico: "abs" | "pct"; setGrafico: (g: "abs" | "pct") => void;
}) {
  const dias = useMemo(() => porDia(d.observacoes), [d]);
  const perfis = d.perfis.filter((p) => p.plataforma === plataforma && p.status_vinculo === "confirmado");
  // votação: deputado estadual MG (todas as candidaturas do cargo, para posição e % dos válidos)
  const eleitoral = useMemo(() => {
    const porCargo = new Map<number, { validos: number; ranking: Map<number, number> }>();
    for (const cargo of new Set(d.perfis.map((p) => (p.candidatura_id ? base.candById.get(p.candidatura_id)?.cargo : undefined)).filter((x): x is number => x != null))) {
      const todas = base.candidaturas.filter((c) => c.cargo === cargo);
      const validos = todas.filter((c) => c.destinacao?.startsWith("Válido")).reduce((s, c) => s + c.votos, 0);
      const nominais = todas.filter((c) => c.tipo === "nominal").sort((a, b) => b.votos - a.votos);
      porCargo.set(cargo, { validos, ranking: new Map(nominais.map((c, i) => [c.id, i + 1])) });
    }
    return porCargo;
  }, [d, base]);

  // datas observadas na plataforma, com quantos perfis têm valor em cada uma
  const datas = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of perfis) for (const dia of dias.get(p.perfil_key)?.keys() ?? []) c.set(dia, (c.get(dia) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [perfis, dias]);
  const deEf = de && datas.some(([x]) => x === de) ? de : datas[0]?.[0] ?? null;
  const ateEf = ate && datas.some(([x]) => x === ate) ? ate : datas[datas.length - 1]?.[0] ?? null;

  const partidos = [...new Set(perfis.map((p) => (p.candidatura_id ? base.candById.get(p.candidatura_id)?.partido : null)).filter(Boolean))] as string[];
  const linhas = useMemo<Linha[]>(() => perfis.map((p) => {
    const cand = p.candidatura_id ? base.candById.get(p.candidatura_id) : undefined;
    const m = dias.get(p.perfil_key);
    const ini = deEf ? m?.get(deEf) ?? null : null;
    const fim = ateEf ? m?.get(ateEf) ?? null : null;
    const ganho = ini && fim ? fim.seguidores! - ini.seguidores! : null;
    const dd = deEf && ateEf ? diasEntre(deEf, ateEf) : null;
    const el = cand ? eleitoral.get(cand.cargo) : undefined;
    return {
      perfil: p, cand, ini, fim, ganho, pctGanho: ganho != null && ini!.seguidores! > 0 ? ganho / ini!.seguidores! : null,
      dias: dd, porDia: ganho != null && dd ? ganho / dd : null,
      votos: cand ? cand.votos : null, pctVal: cand && el?.validos ? cand.votos / el.validos : null,
      posicao: cand ? el?.ranking.get(cand.id) ?? null : null,
    };
  }).filter((l) => partido === "todos" || l.cand?.partido === partido), [perfis, dias, deEf, ateEf, base, eleitoral, partido]);

  const comparaveis = linhas.filter((l) => l.ganho != null);
  const ultima = d.execucoes.find((e) => e.tipo.startsWith("snapshot"));
  const custo = d.execucoes.filter((e) => e.custo_usd).reduce((s, e) => s + (e.custo_usd ?? 0), 0);
  const posEleicao = ateEf != null && ateEf > ELEICAO;
  const linhaSel = linhas.find((l) => l.perfil.perfil_key === sel) ?? null;

  const columns = useMemo<ColumnDef<Linha, unknown>[]>(() => [
    { id: "nome", accessorFn: (l) => l.cand?.nome ?? l.perfil.username, header: L("Candidatura", "Candidacy"), cell: (x) => {
      const l = x.row.original;
      return (
        <button type="button" onClick={() => setSel(l.perfil.perfil_key)} className="text-left font-semibold hover:text-accent">
          {l.cand ? nomeCand(l.cand) : l.perfil.username}{l.cand && <SituacaoBadge c={l.cand} compacto />}
          <div className="text-xs font-normal text-muted">{l.cand ? `${CARGOS[l.cand.cargo]} · ${l.cand.partido}` : L("sem candidatura", "no candidacy")} · @{l.perfil.username}</div>
        </button>
      );
    } },
    { id: "ini", accessorFn: (l) => l.ini?.seguidores ?? undefined, header: `${L("Seguidores", "Followers")} ${deEf ? fmtData(deEf).slice(0, 5) : ""}`,
      cell: (x) => (x.getValue() == null ? <span className="text-muted" title={L("sem observação nesta data", "no observation on this date")}>–</span> : fmt(Number(x.getValue()))),
      sortUndefined: "last", meta: { numeric: true } },
    { id: "fim", accessorFn: (l) => l.fim?.seguidores ?? undefined, header: `${L("Seguidores", "Followers")} ${ateEf ? fmtData(ateEf).slice(0, 5) : ""}`,
      cell: (x) => (x.getValue() == null ? <span className="text-muted" title={L("sem observação nesta data", "no observation on this date")}>–</span> : fmt(Number(x.getValue()))),
      sortUndefined: "last", meta: { numeric: true } },
    { id: "ganho", accessorFn: (l) => l.ganho ?? undefined, header: L("Ganho líquido", "Net gain"), cell: (x) => {
      const v = x.getValue() as number | undefined;
      return v == null ? <span className="text-muted" title={L("período não comparável para este perfil", "period not comparable for this profile")}>{L("n/c", "n/a")}</span>
        : <span className={v >= 0 ? "text-accent" : "text-danger"}>{sinal(v)}{fmt(v)}</span>;
    }, sortUndefined: "last", meta: { numeric: true } },
    { id: "pct", accessorFn: (l) => l.pctGanho ?? undefined, header: L("Crescimento", "Growth"), cell: (x) => {
      const v = x.getValue() as number | undefined;
      return v == null ? <span className="text-muted">–</span> : `${sinal(v)}${pct(v, 1)}`;
    }, sortUndefined: "last", meta: { numeric: true } },
    { id: "dia", accessorFn: (l) => l.porDia ?? undefined, header: L("Ganho/dia", "Gain per day"), cell: (x) => {
      const v = x.getValue() as number | undefined; return v == null ? "–" : `${sinal(v)}${fmt(v)}`;
    }, sortUndefined: "last", meta: { numeric: true } },
    { id: "votos", accessorFn: (l) => l.votos ?? undefined, header: L("Votos (1º turno)", "Votes (1st round)"), cell: (x) => (x.getValue() == null ? "–" : fmt(Number(x.getValue()))), sortUndefined: "last", meta: { numeric: true } },
    { id: "pctval", accessorFn: (l) => l.pctVal ?? undefined, header: L("% válidos do cargo", "% of valid votes for the office"), cell: (x) => (x.getValue() == null ? "–" : pct(Number(x.getValue()))), sortUndefined: "last", meta: { numeric: true } },
    { id: "pos", accessorFn: (l) => l.posicao ?? undefined, header: L("Posição no cargo (MG)", "Rank in office (MG)"), cell: (x) => (x.getValue() == null ? "–" : ordinal(x.getValue())), sortUndefined: "last", meta: { numeric: true } },
  ], [deEf, ateEf, setSel]);
  const exportCols: ExportCol<Linha>[] = [
    { header: L("Candidatura", "Candidacy"), value: (l) => l.cand?.nome ?? "" }, { header: L("Número", "Number"), value: (l) => l.cand?.numero ?? null, type: "number" },
    { header: L("Partido", "Party"), value: (l) => l.cand?.partido ?? "" }, { header: L("Cargo", "Office"), value: (l) => (l.cand ? CARGOS[l.cand.cargo] : "") },
    { header: L("Plataforma", "Platform"), value: (l) => PLATAFORMAS[l.perfil.plataforma] ?? l.perfil.plataforma }, { header: L("Perfil", "Profile"), value: (l) => l.perfil.username },
    { header: L("Data inicial", "Start date"), value: () => deEf ?? "" }, { header: L("Seguidores iniciais", "Starting followers"), value: (l) => l.ini?.seguidores ?? null, type: "number" },
    { header: L("Data final", "End date"), value: () => ateEf ?? "" }, { header: L("Seguidores finais", "Ending followers"), value: (l) => l.fim?.seguidores ?? null, type: "number" },
    { header: L("Ganho líquido", "Net gain"), value: (l) => l.ganho, type: "number" }, { header: L("Crescimento", "Growth"), value: (l) => l.pctGanho, type: "percent" },
    { header: L("Ganho médio diário", "Average gain per day"), value: (l) => l.porDia, type: "number" },
    { header: L("Votos (1º turno 2026)", "Votes (1st round 2026)"), value: (l) => l.votos, type: "number" }, { header: L("% dos válidos do cargo", "% of valid votes for the office"), value: (l) => l.pctVal, type: "percent" },
    { header: L("Posição no cargo (MG)", "Rank in office (MG)"), value: (l) => l.posicao, type: "number" }, { header: L("Situação (TSE)", "Status (TSE)"), value: (l) => (l.cand?.situacao ? situacaoTexto(l.cand.situacao) : "") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="eyebrow">{L("Candidaturas acompanhadas em Minas Gerais · Deputado Estadual · Eleições 2026, 1º turno", "Candidacies tracked in Minas Gerais · State Deputy · 2026 Elections, 1st round")}</div>
        <h1 className="display text-3xl md:text-4xl">{L("Evolução digital e votação", "Digital growth and votes")}</h1>
        <p className="max-w-3xl text-sm text-muted">
          {getLang() === "en" ? <>
            {fmt(new Set(d.perfis.map((p) => p.candidatura_id)).size)} candidacies from the monitoring started in September, with profiles on
            Instagram and X. Followers measured from {fmtData("2026-09-01")} to {fmtData("2026-09-20")} (monitoring) and on {ultima ? fmtData(ultima.terminada_em?.slice(0, 10) ?? ultima.iniciada_em.slice(0, 10)) : "–"} (current
            snapshot, after the {fmtData(ELEICAO)} election). Not a representative sample of MG.
          </> : <>
          {fmt(new Set(d.perfis.map((p) => p.candidatura_id)).size)} candidaturas do monitoramento iniciado em setembro, com perfis no
          Instagram e no X. Seguidores medidos de 01/09 a 20/09 (monitoramento) e em {ultima ? fmtData(ultima.terminada_em?.slice(0, 10) ?? ultima.iniciada_em.slice(0, 10)) : "–"} (snapshot
          atual, depois da eleição de 04/10). Não é uma amostra representativa de MG.
          </>}
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Stat valor={fmt(linhas.length)} rotulo={L(`perfis no ${PLATAFORMAS[plataforma]}`, `profiles on ${PLATAFORMAS[plataforma]}`)} />
        <Stat valor={`${deEf ? fmtData(deEf) : "–"} → ${ateEf ? fmtData(ateEf) : "–"}`} rotulo={L("datas comparadas", "dates compared")} />
        <Stat valor={`${fmt(comparaveis.length)} ${L("de", "of")} ${fmt(linhas.length)}`} rotulo={L("com observação nas duas datas", "with observations on both dates")} />
        <Stat valor={ultima ? fmtDataHora(ultima.terminada_em ?? ultima.iniciada_em) : "–"} rotulo={L("última atualização", "last update")} />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-panel p-3 text-sm">
        <label className="flex flex-col gap-1 text-muted">{L("Plataforma", "Platform")}
          <Segmented label={L("Plataforma", "Platform")} value={plataforma} onChange={(p) => { setPlataforma(p); setDe(null); setAte(null); }}
            options={Object.entries(PLATAFORMAS).map(([id, label]) => ({ id, label }))} />
        </label>
        <label htmlFor="dg-de" className="flex flex-col gap-1 text-muted">{L("De", "From")}
          <select id="dg-de" value={deEf ?? ""} onChange={(e) => setDe(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1 text-ink">
            {datas.map(([x, n]) => <option key={x} value={x}>{fmtData(x)} ({n} {L("perfis", "profiles")})</option>)}
          </select>
        </label>
        <label htmlFor="dg-ate" className="flex flex-col gap-1 text-muted">{L("Até", "To")}
          <select id="dg-ate" value={ateEf ?? ""} onChange={(e) => setAte(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1 text-ink">
            {datas.map(([x, n]) => <option key={x} value={x}>{fmtData(x)}{x > ELEICAO ? L(" · após a eleição", " · after the election") : ""} ({n} {L("perfis", "profiles")})</option>)}
          </select>
        </label>
        {partidos.length > 1 && (
          <label htmlFor="dg-part" className="flex flex-col gap-1 text-muted">{L("Partido", "Party")}
            <select id="dg-part" value={partido} onChange={(e) => setPartido(e.target.value)} className="rounded-md border border-line bg-panel px-2 py-1 text-ink">
              <option value="todos">{L("Todos", "All")}</option>
              {partidos.sort().map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
      </div>
      {posEleicao && (
        <p className="max-w-4xl rounded-md border border-line bg-panel px-3 py-2 text-xs text-muted">
          {getLang() === "en" ? <>
            The end date is after the election ({fmtData(ELEICAO)}): the change includes the days following the result and is neither a
            measurement on election day nor purely an effect of the 1st-round campaign.
          </> : <>
          A data final é posterior à eleição (04/10): a variação inclui os dias seguintes ao resultado e não é uma medição do dia da
          eleição nem só efeito da campanha do 1º turno.
          </>}
        </p>
      )}

      <DataTable titulo={L(`Seguidores no ${PLATAFORMAS[plataforma] ?? plataforma} e votos, por candidatura acompanhada`, `${PLATAFORMAS[plataforma] ?? plataforma} followers and votes, by tracked candidacy`)} data={linhas} columns={columns} exportCols={exportCols} nomeArquivo={`evolucao_digital_mg_${plataforma}_${deEf}_${ateEf}`}
        busca={(l) => `${l.cand?.nome ?? ""} ${l.perfil.username} ${l.cand?.partido ?? ""}`} initialSort={[{ id: "ganho", desc: true }]} pageSize={20}
        atalhos={[
          { label: L("Maior ganho", "Largest gain"), sort: [{ id: "ganho", desc: true }] }, { label: L("Maior crescimento %", "Highest growth %"), sort: [{ id: "pct", desc: true }] },
          { label: L("Mais votos", "Most votes"), sort: [{ id: "votos", desc: true }] }, { label: L("Mais seguidores", "Most followers"), sort: [{ id: "fim", desc: true }] },
        ]} />
      <p className="text-xs text-muted">
        {L(`"n/c": o perfil não tem observação em uma das datas escolhidas (não é zero). Crescimento % sem base (zero seguidores) fica
        indefinido. Seguidores são contas, não eleitores de MG nem votos; plataformas não se somam. % dos válidos: votos da candidatura
        ÷ votos válidos para Deputado Estadual em MG (1º turno 2026). Posição entre todas as candidaturas do cargo no estado.`,
        `"n/a" (not comparable): the profile has no observation on one of the selected dates (it is not zero). Growth % with no base
        (zero followers) is undefined. Followers are accounts, not MG voters nor votes; platforms are not added together. % of valid votes:
        the candidacy's votes ÷ valid votes for State Deputy in MG (1st round 2026). Rank among all candidacies for the office in the state.`)}
      </p>

      <section aria-label={L("Comparação de crescimento", "Growth comparison")} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="display text-2xl">{L("Crescimento entre", "Growth between")} {deEf ? fmtData(deEf) : "–"} {L("e", "and")} {ateEf ? fmtData(ateEf) : "–"}</h2>
          <Segmented label={L("Medida", "Measure")} value={grafico} onChange={setGrafico} options={[{ id: "abs", label: L("Ganho líquido", "Net gain") }, { id: "pct", label: L("Crescimento %", "Growth %") }]} />
        </div>
        <Barras linhas={comparaveis} medida={grafico} onSel={setSel} />
      </section>

      <section aria-label={L("Seguidores e votos", "Followers and votes")} className="flex flex-col gap-2">
        <h2 className="display text-2xl">{L("Seguidores × votos", "Followers × votes")}</h2>
        <Dispersao linhas={linhas.filter((l) => l.fim?.seguidores != null && l.votos != null)} data={ateEf} onSel={setSel} />
        <p className="text-xs text-muted">
          {getLang() === "en" ? <>
            Each dot is a candidacy: followers on {PLATAFORMAS[plataforma]} on {ateEf ? fmtData(ateEf) : "–"} × votes in the 1st round. Logarithmic
            scales. Descriptive: there is no trend line or vote forecast.
          </> : <>
          Cada ponto é uma candidatura: seguidores no {PLATAFORMAS[plataforma]} em {ateEf ? fmtData(ateEf) : "–"} × votos no 1º turno. Escalas
          logarítmicas. Descritivo: não há linha de tendência nem previsão de votos.
          </>}
        </p>
      </section>

      {plataforma === "instagram" && <Organico d={d} base={base} perfis={perfis} onSel={setSel} />}

      {linhaSel && <Detalhe l={linhaSel} d={d} dias={dias} onFechar={() => setSel(null)} />}

      <Cobertura d={d} custo={custo} />
    </div>
  );
}

function Barras({ linhas, medida, onSel }: { linhas: Linha[]; medida: "abs" | "pct"; onSel: (k: string) => void }) {
  const val = (l: Linha) => (medida === "abs" ? l.ganho : l.pctGanho);
  const ord = [...linhas].filter((l) => val(l) != null).sort((a, b) => val(b)! - val(a)!);
  const max = Math.max(1e-9, ...ord.map((l) => Math.abs(val(l)!)));
  if (!ord.length) return <p className="text-sm text-muted">{L("Nenhum perfil com observação nas duas datas.", "No profile with observations on both dates.")}</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {ord.map((l) => {
        const v = val(l)!;
        return (
          <li key={l.perfil.perfil_key}>
            <button type="button" onClick={() => onSel(l.perfil.perfil_key)} className="grid w-full grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-2 text-left hover:text-accent"
              title={`${l.cand?.nome ?? l.perfil.username}: ${medida === "abs" ? `${sinal(v)}${fmt(v)} ${L("seguidores", "followers")}` : `${sinal(v)}${pct(v, 1)}`}`}>
              <span className="truncate">{titulo(l.cand?.nome ?? l.perfil.username)}</span>
              <span className="h-3 rounded-sm" style={{ width: `${(Math.abs(v) / max) * 100}%`, background: v >= 0 ? "var(--accent)" : "var(--danger)" }} />
              <span className="num w-20 text-right">{medida === "abs" ? `${sinal(v)}${fmt(v)}` : `${sinal(v)}${pct(v, 1)}`}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Dispersao({ linhas, data, onSel }: { linhas: Linha[]; data: string | null; onSel: (k: string) => void }) {
  const W = 640, H = 340, P = 48;
  if (linhas.length < 2) return <p className="text-sm text-muted">{L("Poucos perfis com seguidores e votos para o gráfico.", "Too few profiles with followers and votes for the chart.")}</p>;
  const xs = linhas.map((l) => Math.log10(Math.max(1, l.fim!.seguidores!)));
  const ys = linhas.map((l) => Math.log10(Math.max(1, l.votos!)));
  const [x0, x1] = [Math.floor(Math.min(...xs)), Math.ceil(Math.max(...xs))];
  const [y0, y1] = [Math.floor(Math.min(...ys)), Math.ceil(Math.max(...ys))];
  const sx = (v: number) => P + ((v - x0) / Math.max(1, x1 - x0)) * (W - P - 16);
  const sy = (v: number) => H - P - ((v - y0) / Math.max(1, y1 - y0)) * (H - P - 16);
  const ticks = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl" role="img" aria-label={L(`Dispersão de seguidores em ${data ?? ""} e votos`, `Scatter of followers on ${data ? fmtData(data) : ""} and votes`)}>
      {ticks(x0, x1).map((t) => <g key={`x${t}`}><line x1={sx(t)} x2={sx(t)} y1={16} y2={H - P} stroke="var(--line)" /><text x={sx(t)} y={H - P + 16} fontSize="11" textAnchor="middle" fill="var(--muted)">{fmt(10 ** t)}</text></g>)}
      {ticks(y0, y1).map((t) => <g key={`y${t}`}><line x1={P} x2={W - 16} y1={sy(t)} y2={sy(t)} stroke="var(--line)" /><text x={P - 6} y={sy(t) + 4} fontSize="11" textAnchor="end" fill="var(--muted)">{fmt(10 ** t)}</text></g>)}
      <text x={(W + P) / 2} y={H - 8} fontSize="12" textAnchor="middle" fill="var(--muted)">{L("seguidores", "followers")}</text>
      <text x={14} y={(H - P) / 2} fontSize="12" textAnchor="middle" fill="var(--muted)" transform={`rotate(-90 14 ${(H - P) / 2})`}>{L("votos", "votes")}</text>
      {linhas.map((l, i) => (
        <g key={l.perfil.perfil_key} className="cursor-pointer" onClick={() => onSel(l.perfil.perfil_key)}>
          <circle cx={sx(xs[i])} cy={sy(ys[i])} r={9} fill="transparent" />
          <circle cx={sx(xs[i])} cy={sy(ys[i])} r={5} fill={l.cand?.situacao?.startsWith("Eleito") ? "var(--accent)" : "var(--muted)"} stroke="var(--panel)" strokeWidth={2}>
            <title>{L(`${l.cand?.nome ?? l.perfil.username} (${l.cand?.partido ?? ""}) · ${fmt(l.fim!.seguidores!)} seguidores em ${fmtData(l.fim!.data)} · ${fmt(l.votos!)} votos · ${l.cand?.situacao ?? ""}`,
              `${l.cand?.nome ?? l.perfil.username} (${l.cand?.partido ?? ""}) · ${fmt(l.fim!.seguidores!)} followers on ${fmtData(l.fim!.data)} · ${fmt(l.votos!)} votes · ${situacaoTexto(l.cand?.situacao ?? "")}`)}</title>
          </circle>
          <text x={sx(xs[i]) + 8} y={sy(ys[i]) - 6} fontSize="10" fill="var(--ink)">{titulo(l.cand?.nome ?? l.perfil.username).split(" ")[0]}</text>
        </g>
      ))}
      <g transform={`translate(${W - 190}, 22)`} fontSize="11">
        <circle r={5} cx={0} cy={0} fill="var(--accent)" /><text x={10} y={4} fill="var(--muted)">{L("eleita(o)", "elected")}</text>
        <circle r={5} cx={80} cy={0} fill="var(--muted)" /><text x={90} y={4} fill="var(--muted)">{L("não eleita(o)", "not elected")}</text>
      </g>
    </svg>
  );
}

interface LinhaOrg { key: string; nome: string; posts: number; coaut: number; antes: number; curtidas: number | null; comentarios: number | null;
  medInter: number | null; views: number | null; videos: number; ocultas: number; pctNumero: number | null }

function Organico({ d, base, perfis, onSel }: { d: Digital; base: Base; perfis: DigitalPerfil[]; onSel: (k: string) => void }) {
  const exec = d.execucoes.find((e) => e.tipo === "snapshot_apify_posts");
  const linhas = useMemo<LinhaOrg[]>(() => perfis.map((p) => {
    const idx = d.posts.perfil_key.flatMap((k, i) => (k === p.perfil_key ? [i] : []));
    const cand = p.candidatura_id ? base.candById.get(p.candidatura_id) : undefined;
    const inter = idx.map((i) => (d.posts.curtidas[i] == null || d.posts.comentarios[i] == null ? null : d.posts.curtidas[i]! + d.posts.comentarios[i]!));
    const okInter = inter.filter((x): x is number => x != null);
    const vids = idx.filter((i) => d.posts.views[i] != null);
    return {
      key: p.perfil_key, nome: cand?.nome ?? p.username, posts: idx.length, coaut: idx.filter((i) => d.posts.coautoria[i]).length,
      antes: idx.filter((i) => (d.posts.publicado[i] ?? "") < `${ELEICAO}T03:00`).length,
      curtidas: idx.length ? idx.reduce((s, i) => s + (d.posts.curtidas[i] ?? 0), 0) : null,
      comentarios: idx.length ? idx.reduce((s, i) => s + (d.posts.comentarios[i] ?? 0), 0) : null,
      medInter: mediana(okInter), views: vids.length ? vids.reduce((s, i) => s + d.posts.views[i]!, 0) : null, videos: vids.length,
      ocultas: idx.filter((i) => d.posts.curtidas[i] == null).length, pctNumero: null,
    };
  }), [d, perfis, base]);
  const columns = useMemo<ColumnDef<LinhaOrg, unknown>[]>(() => [
    { id: "nome", accessorKey: "nome", header: L("Candidatura", "Candidacy"), cell: (x) => <button type="button" className="text-left font-semibold hover:text-accent" onClick={() => onSel(x.row.original.key)}>{titulo(x.row.original.nome)}</button> },
    { id: "posts", accessorKey: "posts", header: L("Postagens (desde 16/08)", `Posts (since ${fmtData("2026-08-16").slice(0, 5)})`), meta: { numeric: true },
      cell: (x) => <>{fmt(Number(x.getValue()))}{x.row.original.coaut ? <div className="text-xs text-muted">{fmt(x.row.original.coaut)} {L("em coautoria", "co-authored (collab)")}</div> : null}</> },
    { id: "antes", accessorKey: "antes", header: L("até a eleição", "up to the election"), meta: { numeric: true }, cell: (x) => fmt(Number(x.getValue())) },
    { id: "med", accessorFn: (l) => l.medInter ?? undefined, header: L("Interações por postagem (mediana)", "Interactions per post (median)"), sortUndefined: "last", meta: { numeric: true }, cell: (x) => (x.getValue() == null ? "–" : fmt(Number(x.getValue()))) },
    { id: "curt", accessorFn: (l) => l.curtidas ?? undefined, header: L("Curtidas (soma)", "Likes (total)"), sortUndefined: "last", meta: { numeric: true }, cell: (x) => (x.getValue() == null ? "–" : fmt(Number(x.getValue()))) },
    { id: "com", accessorFn: (l) => l.comentarios ?? undefined, header: L("Comentários (soma)", "Comments (total)"), sortUndefined: "last", meta: { numeric: true }, cell: (x) => (x.getValue() == null ? "–" : fmt(Number(x.getValue()))) },
  ], [onSel]);
  const exportCols: ExportCol<LinhaOrg>[] = [
    { header: L("Candidatura", "Candidacy"), value: (l) => l.nome }, { header: L("Postagens desde 16/08", "Posts since 2026-08-16"), value: (l) => l.posts, type: "number" },
    { header: L("das quais em coautoria", "of which co-authored (collab)"), value: (l) => l.coaut, type: "number" },
    { header: L("Postagens até 04/10", "Posts up to 2026-10-04"), value: (l) => l.antes, type: "number" }, { header: L("Interações por postagem (mediana)", "Interactions per post (median)"), value: (l) => l.medInter, type: "number" },
    { header: L("Curtidas (soma)", "Likes (total)"), value: (l) => l.curtidas, type: "number" }, { header: L("Comentários (soma)", "Comments (total)"), value: (l) => l.comentarios, type: "number" },
    { header: L("Postagens com curtidas ocultas", "Posts with hidden likes"), value: (l) => l.ocultas, type: "number" },
  ];
  if (!exec) return null;
  return (
    <section aria-label={L("Orgânico no Instagram", "Organic on Instagram")} className="flex flex-col gap-2">
      <h2 className="display text-2xl">{L("Orgânico no Instagram", "Organic on Instagram")}</h2>
      <DataTable titulo={L("Postagens no Instagram por candidatura (orgânico, desde 16/08)", "Instagram posts by candidacy (organic, since Aug 16)")} data={linhas} columns={columns} exportCols={exportCols} nomeArquivo="organico_instagram_mg" initialSort={[{ id: "med", desc: true }]} pageSize={20} />
      <p className="text-xs text-muted">
        {getLang() === "en" ? <>
          Posts published since {fmtData("2026-08-16")} (start of the campaign), collected on {fmtDataHora(exec.terminada_em ?? exec.iniciada_em)}. Likes and
          comments are the totals accumulated at collection time (video views are not included in the basic collection package): older posts had more time to accumulate. Interactions =
          likes + comments. Co-authored (collab): a post by another account (party, ally, outlet) with the candidacy as co-author —
          the same post counts for each tracked co-author. No engagement rate (followers on each post's date are not known). Posts with hidden
          likes are excluded from the median.
        </> : <>
        Postagens publicadas desde 16/08/2026 (início da campanha), coletadas em {fmtDataHora(exec.terminada_em ?? exec.iniciada_em)}. Curtidas e
        comentários são os acumulados no momento da coleta (visualizações de vídeo não vêm no pacote básico de coleta): postagens antigas tiveram mais tempo para acumular. Interações =
        curtidas + comentários. Coautoria: postagem de outra conta (partido, aliada, veículo) com a candidatura como coautora —
        a mesma postagem conta para cada coautora acompanhada. Sem taxa de engajamento (os seguidores de cada data da postagem não são conhecidos). Postagens com curtidas
        ocultas ficam fora da mediana.
        </>}
      </p>
    </section>
  );
}

function Detalhe({ l, d, dias, onFechar }: { l: Linha; d: Digital; dias: Map<string, Map<string, DigitalObs>>; onFechar: () => void }) {
  const obs = d.observacoes.filter((o) => o.perfil_key === l.perfil.perfil_key);
  const pontos = [...(dias.get(l.perfil.perfil_key)?.values() ?? [])].sort((a, b) => a.data!.localeCompare(b.data!));
  return (
    <section aria-label={L("Detalhe da candidatura", "Candidacy details")} className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="eyebrow">{l.cand ? `${CARGOS[l.cand.cargo]} · ${l.cand.partido} · ${l.cand.numero}` : L("sem candidatura", "no candidacy")}</div>
          <h2 className="display text-2xl">{l.cand ? titulo(l.cand.nome) : l.perfil.username}{l.cand && <SituacaoBadge c={l.cand} />}</h2>
          <a href={l.perfil.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent">@{l.perfil.username} {L("no", "on")} {PLATAFORMAS[l.perfil.plataforma]} ↗</a>
          {l.cand && <> · <Link to={`/c/${l.cand.id}`} className="text-sm text-accent">{L("painel eleitoral", "election dashboard")}</Link></>}
        </div>
        <button type="button" onClick={onFechar} className="rounded-md border border-line px-3 py-1 text-sm hover:bg-accent-soft">{L("Fechar", "Close")}</button>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <Stat valor={l.votos != null ? fmt(l.votos) : "–"} rotulo={L("votos no 1º turno", "votes in the 1st round")} />
        <Stat valor={l.pctVal != null ? pct(l.pctVal) : "–"} rotulo={L("dos válidos para Dep. Estadual (MG)", "of valid votes for State Deputy (MG)")} />
        <Stat valor={l.posicao != null ? ordinal(l.posicao) : "–"} rotulo={L("posição no cargo em MG", "rank in office in MG")} />
        <Stat valor={l.cand?.situacao ? situacaoTexto(l.cand.situacao) : "–"} rotulo={L("situação (TSE)", "status (TSE)")} />
      </div>
      {pontos.length >= 2 && <Serie pontos={pontos} />}
      <div className="overflow-x-auto">
        <TituloTabela>{L("Observações de seguidores do perfil (histórico e snapshot atual)", "Profile follower observations (history and current snapshot)")}</TituloTabela>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1 pr-3">{L("Data", "Date")}</th><th className="pr-3 text-right">{L("Seguidores", "Followers")}</th><th className="pr-3 text-right">{L("Seguindo", "Following")}</th><th className="pr-3 text-right">{L("Publicações", "Posts")}</th><th className="pr-3">{L("Origem da data", "Date origin")}</th><th className="pr-3">{L("Fonte", "Source")}</th><th>Status</th></tr></thead>
          <tbody>{obs.map((o, i) => (
            <tr key={i} className="border-t border-line align-top">
              <td className="py-1 pr-3">{o.data ? fmtData(o.data) : L("desconhecida", "unknown")}{o.observado_em ? <div className="text-xs text-muted">{fmtDataHora(o.observado_em)}</div> : null}</td>
              <td className="num pr-3 text-right">{o.seguidores != null ? fmt(o.seguidores) : "–"}</td>
              <td className="num pr-3 text-right">{o.seguindo != null ? fmt(o.seguindo) : "–"}</td>
              <td className="num pr-3 text-right">{o.posts != null ? fmt(o.posts) : "–"}</td>
              <td className="pr-3 text-xs">{o.origem_data}</td>
              <td className="pr-3 text-xs" title={o.fonte_arquivo ?? ""}>{o.fonte.startsWith("apify") ? L("snapshot atual (Apify)", "current snapshot (Apify)") : L("monitoramento", "monitoring")} · {o.precisao}</td>
              <td className="text-xs">{o.status}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        {l.perfil.evidencia}. {L(`"Publicações" é o total do perfil na data (exclusões e arquivamentos mudam esse número; não é o que foi
        publicado no período).`, `"Posts" is the profile's total on that date (deletions and archiving change this number; it is not what was
        posted in the period).`)} {l.perfil.plataforma === "x" && L("No X, o número vem do próprio perfil dentro das buscas de menções: só existe nas semanas em que a pessoa postou.",
          "On X, the number comes from the profile itself within mention searches: it only exists for weeks in which the person posted.")}
      </p>
    </section>
  );
}

function Serie({ pontos }: { pontos: DigitalObs[] }) {
  const W = 640, H = 180, P = 40;
  const t = pontos.map((p) => Date.parse(p.data!));
  const v = pontos.map((p) => p.seguidores!);
  const [t0, t1] = [Math.min(...t), Math.max(...t)];
  const [v0, v1] = [Math.min(...v), Math.max(...v)];
  const sx = (x: number) => P + ((x - t0) / Math.max(1, t1 - t0)) * (W - P - 20);
  const sy = (y: number) => H - 28 - ((y - v0) / Math.max(1, v1 - v0)) * (H - 50);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-3xl" role="img" aria-label={L("Seguidores nas datas observadas", "Followers on observed dates")}>
      {pontos.slice(1).map((p, i) => {
        const gap = diasEntre(pontos[i].data!, p.data!) > 8; // intervalo longo sem coleta: tracejado
        return <line key={i} x1={sx(t[i])} y1={sy(v[i])} x2={sx(t[i + 1])} y2={sy(v[i + 1])} stroke="var(--accent)" strokeWidth={2} strokeDasharray={gap ? "4 4" : undefined} />;
      })}
      {pontos.map((p, i) => (
        <g key={i}>
          <circle cx={sx(t[i])} cy={sy(v[i])} r={4} fill="var(--accent)"><title>{`${fmtData(p.data)}: ${fmt(p.seguidores!)} ${L("seguidores", "followers")}`}</title></circle>
          <text x={sx(t[i])} y={H - 8} fontSize="10" textAnchor="middle" fill="var(--muted)">{fmtData(p.data).slice(0, 5)}</text>
          <text x={sx(t[i])} y={sy(v[i]) - 8} fontSize="10" textAnchor="middle" fill="var(--ink)">{fmt(p.seguidores!)}</text>
        </g>
      ))}
    </svg>
  );
}

function Cobertura({ d, custo }: { d: Digital; custo: number }) {
  return (
    <details className="text-sm text-muted">
      <summary className="cursor-pointer text-ink">{L("Cobertura, fontes e limitações", "Coverage, sources and limitations")}</summary>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
        {getLang() === "en" ? <>
          <li>History: September monitoring (series and snapshots from September 1, 4, 6, 13 and 20). The September 6 date comes only from the
            spreadsheet report; the September 20 ones collected at night appear as September 20 (Brasília time).</li>
          <li>Current snapshot: Instagram profiles (followers, following, posts) and posts since August 16. There was no current snapshot on X.</li>
          <li>Profiles linked to the candidacy by ballot number, office and state in the TSE data, with name and party checked.</li>
          <li>Cost of the current collections: US$ {dec(custo, 4)} (amount reported by the platform).</li>
        </> : <>
        <li>Histórico: monitoramento de setembro (séries e snapshots de 01, 04, 06, 13 e 20/09). A data de 06/09 vem só do relatório em
          planilha; as de 20/09 coletadas à noite aparecem como 20/09 (horário de Brasília).</li>
        <li>Snapshot atual: perfis do Instagram (seguidores, seguindo, publicações) e postagens desde 16/08. No X não houve snapshot atual.</li>
        <li>Perfis ligados à candidatura pelo número de urna, cargo e UF no TSE, com nome e partido conferidos.</li>
        <li>Custo das coletas atuais: US$ {dec(custo, 4)} (valor informado pela plataforma).</li>
        </>}
        {d.execucoes.filter((e) => e.falhas && Object.keys(e.falhas).length).map((e) => (
          <li key={e.id}>{L("Falhas em", "Failures on")} {fmtDataHora(e.terminada_em ?? e.iniciada_em)}: {Object.entries(e.falhas!).map(([u, m]) => `@${u} (${m})`).join(", ")}</li>
        ))}
      </ul>
    </details>
  );
}
