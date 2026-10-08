import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { DataTable } from "../components/DataTable";
import { LazyMap } from "../components/LazyMap";
import { CandidatePicker, ErrorBox, Loading, MunicipioSelect, Segmented, SituacaoBadge, nomeCand } from "../components/ui";
import { BIVAR, cssRgb, prefersDark, type RGB } from "../lib/colors";
import { agregar, porLocal, useBase, useTotais, useVotos, type Base, type PorLocal } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { dec, fmt, pct, titulo } from "../lib/format";
import { L, getLang } from "../lib/i18n";
import { CARGOS, type Candidatura } from "../lib/types";
import { useUf } from "../lib/uf";

const nivelTxt = () => [L("baixo", "low"), L("médio", "medium"), L("alto", "high")];

function tercis(vals: number[]): [number, number] {
  const s = vals.filter((v) => v > 0).sort((a, b) => a - b);
  if (!s.length) return [0, 0];
  return [s[Math.floor(s.length / 3)], s[Math.floor((2 * s.length) / 3)]];
}
const nivelDe = (v: number, [t1, t2]: [number, number]) => (v > t2 ? 2 : v > t1 ? 1 : 0);

export function Dobrada() {
  const [sp, setSp] = useSearchParams();
  const base = useBase();
  const destaque = base.data?.candidaturasDestaque ?? [];
  // Padrão: as duas candidaturas em destaque; com uma só, cruza com o Lula (presidente).
  const lula = base.data?.candidaturas.find((c) => c.cargo === 1 && c.numero === 13 && c.tipo === "nominal")?.id;
  // ids da URL que não existem nesta UF caem no padrão (link de outro estado com ?uf= trocado)
  const daUf = (v: string | null) => (v != null && base.data?.candById.has(Number(v)) ? Number(v) : undefined);
  const aId = daUf(sp.get("a")) ?? (destaque.length > 1 ? destaque[1] : lula) ?? destaque[0] ?? NaN;
  const bId = daUf(sp.get("b")) ?? destaque[0] ?? NaN;
  const municipio = sp.get("mun");
  const modo = (sp.get("modo") === "territorios" && municipio ? "territorios" : "escolas") as "escolas" | "territorios";
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v == null) n.delete(k); else n.set(k, v);
    setSp(n, { replace: true });
  };
  const { info } = useUf();
  // dobradas fixadas na visão geral ganham explicação do gráfico e análise
  const destacada = (info.dobradas ?? []).some(([x, y]) => (x === aId && y === bId) || (x === bId && y === aId));
  const a = base.data?.candById.get(aId);
  const b = base.data?.candById.get(bId);
  const votos = useVotos([aId, bId].filter(Number.isFinite), municipio);
  const ta = useTotais(a?.cargo, municipio);
  const tb = useTotais(b?.cargo, municipio);

  const pa = useMemo(() => (base.data && votos.data && ta.data && a ? porLocal(base.data, votos.data[a.id], ta.data) : undefined), [base.data, votos.data, ta.data, a]);
  const pb = useMemo(() => (base.data && votos.data && tb.data && b ? porLocal(base.data, votos.data[b.id], tb.data) : undefined), [base.data, votos.data, tb.data, b]);

  const analise = useMemo(() => {
    if (!base.data || !pa || !pb) return null;
    const locais = base.data.locais.filter((l) => (!municipio || l.mun === municipio) && pa.validos[l.idx] > 0);
    const xa = locais.map((l) => pa.votos[l.idx] / pa.validos[l.idx]);
    const xb = locais.map((l) => (pb.validos[l.idx] ? pb.votos[l.idx] / pb.validos[l.idx] : 0));
    const ta_ = tercis(xa), tb_ = tercis(xb);
    const classe = new Int8Array(base.data.locais.length).fill(-1);
    locais.forEach((l, i) => { classe[l.idx] = nivelDe(xa[i], ta_) * 3 + nivelDe(xb[i], tb_); });
    return { locais, xa, xb, ta: ta_, tb: tb_, classe };
  }, [base.data, pa, pb, municipio]);

  const corPorLocal = useMemo(() => {
    if (!analise) return undefined;
    return (idx: number): RGB | null => {
      const k = analise.classe[idx];
      return k < 0 ? null : BIVAR[Math.floor(k / 3)][k % 3];
    };
  }, [analise]);

  // série usada pelo mapa só para posição/tamanho dos círculos: soma das duas
  const soma = useMemo<PorLocal | undefined>(() => {
    if (!pa || !pb) return undefined;
    const v = new Float64Array(pa.votos.length);
    for (let i = 0; i < v.length; i++) v[i] = pa.votos[i] + pb.votos[i];
    return { votos: v, validos: pa.validos, total: pa.total + pb.total, totalValidos: pa.totalValidos };
  }, [pa, pb]);

  if (base.error) return <ErrorBox error={base.error} />;
  if (!base.data) return <Loading />;
  const B = base.data;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <div className="eyebrow">{L("Dobrada", "Joint ticket")}</div>
        <h1 className="display text-3xl">
          {a ? <>{nomeCand(a)}<SituacaoBadge c={a} compacto /></> : "?"} × {b ? <>{nomeCand(b)}<SituacaoBadge c={b} compacto /></> : "?"}
        </h1>
        <p className="max-w-3xl text-muted">
          {L(
            "Cada local de votação é classificado pelos tercis da % dos válidos de cada candidatura no recorte: onde as duas são fortes juntas, onde só uma é, e onde nenhuma é.",
            "Each polling place is classified by the terciles of each candidate's % of valid votes in the selection: where both are strong together, where only one is, and where neither is.",
          )}
        </p>
      </header>
      <div className="grid gap-3 md:grid-cols-3">
        <div><div className="mb-1 text-sm text-muted">{L("Candidatura A (eixo roxo)", "Candidate A (purple axis)")}</div>
          <CandidatePicker id="pick-a" base={B} onPick={(c) => set("a", String(c.id))} placeholder={a ? nomeCand(a) : L("Escolher…", "Choose…")} /></div>
        <div><div className="mb-1 text-sm text-muted">{L("Candidatura B (eixo verde-azulado)", "Candidate B (teal axis)")}</div>
          <CandidatePicker id="pick-b" base={B} onPick={(c) => set("b", String(c.id))} placeholder={b ? nomeCand(b) : L("Escolher…", "Choose…")} /></div>
        <MunicipioSelect base={B} value={municipio} onChange={(cd) => set("mun", cd)} id="mun-dob" />
      </div>
      {votos.error && <ErrorBox error={votos.error} />}
      {!analise || !a || !b || !soma ? <Loading texto={L("Cruzando as candidaturas…", "Crossing the candidacies…")} /> : (
        <>
          {municipio && (
            <Segmented label={L("Modo do mapa", "Map mode")} value={modo} onChange={(m) => set("modo", m)}
              options={[{ id: "escolas", label: L("Escolas", "Polling places") }, { id: "territorios", label: L("Territórios", "Areas") }]} />
          )}
          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <LazyMap base={B} dados={soma} municipio={municipio} modo={modo} metrica="votos" corPorLocal={corPorLocal}
              rotuloSerie={L("votos somados", "combined votes")} onMunicipio={(cd) => set("mun", cd)} />
            <aside className="flex min-w-0 flex-col gap-4">
              <LegendaBivariada a={a} b={b} />
              <Dispersao analise={analise} a={a} b={b} />
              {destacada && <ComoLer a={a} b={b} />}
              <Contagem analise={analise} />
            </aside>
          </div>
          {destacada && <AnaliseDobrada base={B} analise={analise} pa={pa!} pb={pb!} a={a} b={b} municipio={municipio} />}
          <TabelaDobrada base={B} a={a} b={b} pa={pa!} pb={pb!} municipio={municipio} />
        </>
      )}
    </div>
  );
}

function LegendaBivariada({ a, b }: { a: Candidatura; b: Candidatura }) {
  const NIVEL_TXT = nivelTxt();
  return (
    <div className="flex items-end gap-3" aria-label={L("Legenda bivariada", "Bivariate legend")}>
      <div className="grid grid-cols-3" style={{ width: 96 }}>
        {[2, 1, 0].map((ia) => [0, 1, 2].map((ib) => (
          <span key={`${ia}${ib}`} className="h-8" style={{ background: cssRgb(BIVAR[ia][ib]) }}
            title={`${a.nome}: ${NIVEL_TXT[ia]} · ${b.nome}: ${NIVEL_TXT[ib]}`} />
        )))}
      </div>
      <div className="text-xs text-muted">
        <div>↑ {a.nome} ({CARGOS[a.cargo]})</div>
        <div>→ {b.nome} ({CARGOS[b.cargo]})</div>
        <div className="mt-1">{L("canto escuro = as duas fortes", "dark corner = both strong")}</div>
      </div>
    </div>
  );
}

function Contagem({ analise }: { analise: { classe: Int8Array } }) {
  const n = new Array(9).fill(0);
  analise.classe.forEach((k) => { if (k >= 0) n[k]++; });
  const total = n.reduce((x, y) => x + y, 0) || 1;
  const linhas = [
    { k: 8, t: L("As duas fortes", "Both strong") }, { k: 6, t: L("Só A forte", "Only A strong") }, { k: 2, t: L("Só B forte", "Only B strong") }, { k: 0, t: L("As duas fracas", "Both weak") },
  ];
  return (
    <ul className="text-sm">
      {linhas.map(({ k, t }) => (
        <li key={k} className="flex items-center gap-2 border-b border-line py-1">
          <span className="h-3 w-3 rounded-sm" style={{ background: cssRgb(BIVAR[Math.floor(k / 3)][k % 3]) }} />
          {t}<span className="num ml-auto">{fmt(n[k])} {L("locais", "places")} · {pct(n[k] / total, 0)}</span>
        </li>
      ))}
    </ul>
  );
}

function Dispersao({ analise, a, b }: { analise: { xa: number[]; xb: number[]; ta: [number, number]; tb: [number, number] }; a: Candidatura; b: Candidatura }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const dark = prefersDark();
    const pad = 30;
    const mx = Math.max(...analise.xb, 0.001), my = Math.max(...analise.xa, 0.001);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = dark ? "#342a3c" : "#e4dce8";
    ctx.beginPath(); ctx.moveTo(pad, 4); ctx.lineTo(pad, H - pad); ctx.lineTo(W - 4, H - pad); ctx.stroke();
    // cortes dos tercis (as mesmas faixas de cor do mapa)
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = dark ? "#5c5463" : "#c9bfce";
    for (const t of analise.tb) { const x = pad + (t / mx) * (W - pad - 6); ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H - pad); ctx.stroke(); }
    for (const t of analise.ta) { const y = H - pad - (t / my) * (H - pad - 6); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - 4, y); ctx.stroke(); }
    ctx.setLineDash([]);
    analise.xa.forEach((ya, i) => {
      const xb = analise.xb[i];
      const k = nivelDe(ya, analise.ta) * 3 + nivelDe(xb, analise.tb);
      ctx.fillStyle = cssRgb(BIVAR[Math.floor(k / 3)][k % 3]);
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(pad + (xb / mx) * (W - pad - 6), H - pad - (ya / my) * (H - pad - 6), 2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = dark ? "#b3a6ba" : "#6b5f72";
    ctx.font = "11px 'Source Sans 3', sans-serif";
    ctx.fillText(L(`${b.nome} (% válidos) →`, `${b.nome} (% valid votes) →`), pad, H - 10);
    ctx.save(); ctx.translate(12, H - pad); ctx.rotate(-Math.PI / 2); ctx.fillText(`${a.nome} →`, 0, 0); ctx.restore();
    ctx.fillText(pct(mx, 1), W - 40, H - pad + 12);
    ctx.fillText(pct(my, 1), pad + 4, 12);
  }, [analise, a, b]);
  return <canvas ref={ref} className="h-56 w-full" role="img" aria-label={L(`Dispersão por local: % de ${a.nome} × % de ${b.nome}`, `Scatter by polling place: % for ${a.nome} × % for ${b.nome}`)} />;
}

interface LinhaD { key: string; nome: string; municipio: string; bairro?: string; va: number; vb: number; pa: number; pb: number }

function TabelaDobrada({ base, a, b, pa, pb, municipio }: { base: Base; a: Candidatura; b: Candidatura; pa: PorLocal; pb: PorLocal; municipio: string | null }) {
  const nivel = municipio ? "local" : "municipio";
  const linhas = useMemo<LinhaD[]>(() => {
    const ma = agregar(base, pa, nivel, municipio);
    const mb = new Map(agregar(base, pb, nivel, municipio).map((l) => [l.key, l]));
    return ma.map((l) => {
      const o = mb.get(l.key);
      return { key: l.key, nome: l.nome, municipio: l.municipio, bairro: l.bairro, va: l.votos, vb: o?.votos ?? 0, pa: l.pct, pb: o?.pct ?? 0 };
    });
  }, [base, pa, pb, nivel, municipio]);
  const columns = useMemo<ColumnDef<LinhaD, unknown>[]>(() => [
    { id: "nome", accessorKey: "nome", header: nivel === "local" ? L("Escola / local", "Polling place") : L("Município", "City"),
      cell: (c) => <div><div className="font-semibold">{nivel === "local" ? c.row.original.nome : titulo(c.row.original.nome)}</div>
        {nivel === "local" && <div className="text-xs text-muted">{titulo(c.row.original.bairro ?? "")}</div>}</div> },
    { id: "va", accessorKey: "va", header: L(`${a.nome} (votos)`, `${a.nome} (votes)`), cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    { id: "pa", accessorKey: "pa", header: `${a.nome} (%)`, cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
    { id: "vb", accessorKey: "vb", header: L(`${b.nome} (votos)`, `${b.nome} (votes)`), cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    { id: "pb", accessorKey: "pb", header: `${b.nome} (%)`, cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
  ], [a, b, nivel]);
  const exportCols: ExportCol<LinhaD>[] = [
    { header: nivel === "local" ? L("Local de votação", "Polling place") : L("Município", "City"), value: (r) => r.nome },
    { header: L("Município", "City"), value: (r) => r.municipio },
    { header: L("Bairro", "Neighborhood"), value: (r) => r.bairro ?? "" },
    { header: L(`${a.numero} ${a.nome} (votos)`, `${a.numero} ${a.nome} (votes)`), value: (r) => r.va, type: "number" },
    { header: L(`${a.numero} ${a.nome} (% válidos)`, `${a.numero} ${a.nome} (% valid votes)`), value: (r) => r.pa, type: "percent" },
    { header: L(`${b.numero} ${b.nome} (votos)`, `${b.numero} ${b.nome} (votes)`), value: (r) => r.vb, type: "number" },
    { header: L(`${b.numero} ${b.nome} (% válidos)`, `${b.numero} ${b.nome} (% valid votes)`), value: (r) => r.pb, type: "percent" },
  ];
  return (
    <DataTable titulo={L(`Votos das duas candidaturas, por ${nivel === "local" ? "escola" : "cidade"}`, `Votes of both candidacies, by ${nivel === "local" ? "polling place" : "city"}`)} data={linhas} columns={columns} exportCols={exportCols} nomeArquivo={`dobrada_${a.numero}_${b.numero}`}
      busca={(r) => `${r.nome} ${r.municipio} ${r.bairro ?? ""}`} initialSort={[{ id: "va", desc: true }]} />
  );
}

function ComoLer({ a, b }: { a: Candidatura; b: Candidatura }) {
  return (
    <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-muted">
      <b className="text-ink">{L("Como ler o gráfico", "How to read the chart")}</b>
      {getLang() === "en" ? (<>
      <p>
        Each dot is a polling place. Horizontally, the % of valid votes for {titulo(b.nome)} ({CARGOS[b.cargo]}) at that place;
        vertically, the % for {titulo(a.nome)} ({CARGOS[a.cargo]}).
      </p>
      <p>
        The dotted lines cut each axis into three bands with the same number of places (low, medium, high) — these are the map's
        colors. Dots in the upper-right corner (dark blue) are places where both are in their strongest third.
      </p>
      <p>
        If the cloud rises from left to right, both grow in the same places. "Arms" hugging one axis show strongholds of only
        one. The chart describes where the votes coincide; it does not show that one vote pulled the other.
      </p>
      </>) : (<>
      <p>
        Cada ponto é um local de votação. Na horizontal, a % dos válidos de {titulo(b.nome)} ({CARGOS[b.cargo]}) naquele local;
        na vertical, a % de {titulo(a.nome)} ({CARGOS[a.cargo]}).
      </p>
      <p>
        As linhas pontilhadas cortam cada eixo em três faixas com o mesmo número de locais (baixo, médio, alto) — são as cores do
        mapa. Pontos no canto superior direito (azul-escuro) são locais em que as duas estão no terço mais forte.
      </p>
      <p>
        Se a nuvem sobe da esquerda para a direita, as duas crescem nos mesmos lugares. "Braços" colados a um eixo mostram
        redutos de uma só. O gráfico descreve onde os votos coincidem; não mostra que um voto puxou o outro.
      </p>
      </>)}
    </div>
  );
}

/** Pearson entre as % dos válidos das duas candidaturas, local a local. */
function correlacao(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return NaN;
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

function AnaliseDobrada({ base, analise, pa, pb, a, b, municipio }: {
  base: Base; analise: { locais: Base["locais"]; xa: number[]; xb: number[]; classe: Int8Array };
  pa: PorLocal; pb: PorLocal; a: Candidatura; b: Candidatura; municipio: string | null;
}) {
  const r = useMemo(() => {
    const rho = correlacao(analise.xa, analise.xb);
    let totA = 0, totB = 0, ambasA = 0, ambasB = 0;
    const soA = new Map<string, number>(), soB = new Map<string, number>(); // unidade -> votos nos redutos exclusivos
    const n = new Array(9).fill(0);
    for (const l of analise.locais) {
      const k = analise.classe[l.idx];
      if (k < 0) continue;
      n[k]++;
      const va = pa.votos[l.idx], vb = pb.votos[l.idx];
      totA += va; totB += vb;
      if (k === 8) { ambasA += va; ambasB += vb; }
      const u = municipio ? l.bairro : l.munNome;
      if (k === 6) soA.set(u, (soA.get(u) ?? 0) + va);
      if (k === 2) soB.set(u, (soB.get(u) ?? 0) + vb);
    }
    const top = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([u]) => titulo(u));
    const total = n.reduce((x, y) => x + y, 0) || 1;
    return { rho, n, total, pAmbasA: totA ? ambasA / totA : 0, pAmbasB: totB ? ambasB / totB : 0, topA: top(soA), topB: top(soB) };
  }, [analise, pa, pb, municipio]);

  const forca = !Number.isFinite(r.rho) ? L("indefinida", "Undefined") : r.rho >= 0.6 ? L("forte", "Strong") : r.rho >= 0.3 ? L("moderada", "Moderate") : r.rho > 0 ? L("fraca", "Weak") : L("nula ou negativa", "Null or negative");
  const A = titulo(a.nome), Bn = titulo(b.nome);
  const nomeMun = municipio ? titulo(base.munByCd.get(municipio)?.nome ?? "") : "";
  const onde = municipio ? L(`em ${nomeMun}`, `in ${nomeMun}`) : L("no estado", "in the state");
  const unid = municipio ? "bairros" : "cidades";
  const rhoTxt = Number.isFinite(r.rho) ? dec(r.rho, 2) : "–";
  if (getLang() === "en") return (
    <section aria-label="Joint ticket analysis" className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
      <h2 className="display text-xl">Joint ticket analysis {onde}</h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
        <li>
          <b>{forca} territorial overlap</b> (correlation of {rhoTxt} between
          the % of valid votes, place by place; 1 would be a perfect match and 0, no relationship).
        </li>
        <li>
          In <b className="num">{fmt(r.n[8])}</b> places ({pct(r.n[8] / r.total, 0)}) both are in their strongest third. These places
          account for <b>{pct(r.pAmbasA, 0)}</b> of {A}'s votes and <b>{pct(r.pAmbasB, 0)}</b> of {Bn}'s votes {onde}.
        </li>
        <li>
          Strongholds of {A} only: <b className="num">{fmt(r.n[6])}</b> places{r.topA.length ? <>, mainly in {r.topA.join(", ")}</> : null}.
          {" "}Strongholds of {Bn} only: <b className="num">{fmt(r.n[2])}</b> places{r.topB.length ? <>, mainly in {r.topB.join(", ")}</> : null}.
          {" "}These are the {municipio ? "neighborhoods" : "cities"} where one candidate has their own base and the other has not caught up yet.
        </li>
        <li>
          In <b className="num">{fmt(r.n[0])}</b> places ({pct(r.n[0] / r.total, 0)}) both are in their weakest third.
        </li>
      </ul>
      <p className="text-xs text-muted">
        Descriptive reading aggregated by polling place: it shows where the votes coincide, not that voters voted for both nor
        that one candidate transferred votes to the other. Different offices have different valid votes; that is why the comparison uses
        the % of valid votes for each office.
      </p>
    </section>
  );
  return (
    <section aria-label="Análise da dobrada" className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
      <h2 className="display text-xl">Análise da dobrada {onde}</h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
        <li>
          <b>Coincidência territorial {forca}</b> (correlação de {rhoTxt} entre
          as % dos válidos, local a local; 1 seria coincidência perfeita e 0, nenhuma relação).
        </li>
        <li>
          Em <b className="num">{fmt(r.n[8])}</b> locais ({pct(r.n[8] / r.total, 0)}) as duas estão no terço mais forte. Esses locais
          concentram <b>{pct(r.pAmbasA, 0)}</b> dos votos de {A} e <b>{pct(r.pAmbasB, 0)}</b> dos votos de {Bn} {onde}.
        </li>
        <li>
          Redutos só de {A}: <b className="num">{fmt(r.n[6])}</b> locais{r.topA.length ? <>, sobretudo em {r.topA.join(", ")}</> : null}.
          {" "}Redutos só de {Bn}: <b className="num">{fmt(r.n[2])}</b> locais{r.topB.length ? <>, sobretudo em {r.topB.join(", ")}</> : null}.
          {" "}São os {unid} onde uma candidatura tem base própria e a outra ainda não acompanha.
        </li>
        <li>
          Em <b className="num">{fmt(r.n[0])}</b> locais ({pct(r.n[0] / r.total, 0)}) as duas estão no terço mais fraco.
        </li>
      </ul>
      <p className="text-xs text-muted">
        Leitura descritiva e agregada por local de votação: mostra onde os votos coincidem, não que eleitores votaram nas duas nem
        que uma candidatura transferiu votos para a outra. Cargos diferentes têm votos válidos diferentes; por isso a comparação usa
        a % dos válidos de cada cargo.
      </p>
    </section>
  );
}
