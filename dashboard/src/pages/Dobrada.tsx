import type { ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { DataTable } from "../components/DataTable";
import { LazyMap } from "../components/LazyMap";
import { CandidatePicker, ErrorBox, Loading, MunicipioSelect, Segmented, SituacaoBadge, nomeCand } from "../components/ui";
import { BIVAR, cssRgb, prefersDark, type RGB } from "../lib/colors";
import { agregar, porLocal, useBase, useTotais, useVotos, type Base, type PorLocal } from "../lib/data";
import type { ExportCol } from "../lib/export";
import { fmt, pct, titulo } from "../lib/format";
import { CARGOS, type Candidatura } from "../lib/types";

const NIVEL_TXT = ["baixo", "médio", "alto"];

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
  const aId = Number(sp.get("a") ?? (destaque.length > 1 ? destaque[1] : lula) ?? destaque[0]);
  const bId = Number(sp.get("b") ?? destaque[0]);
  const municipio = sp.get("mun");
  const modo = (sp.get("modo") === "territorios" && municipio ? "territorios" : "escolas") as "escolas" | "territorios";
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v == null) n.delete(k); else n.set(k, v);
    setSp(n, { replace: true });
  };
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
        <div className="eyebrow">Dobrada</div>
        <h1 className="display text-3xl">
          {a ? <>{nomeCand(a)}<SituacaoBadge c={a} compacto /></> : "?"} × {b ? <>{nomeCand(b)}<SituacaoBadge c={b} compacto /></> : "?"}
        </h1>
        <p className="max-w-3xl text-muted">
          Cada local de votação é classificado pelos tercis da % dos válidos de cada candidatura no recorte: onde as duas são fortes juntas, onde só uma é, e onde nenhuma é.
        </p>
      </header>
      <div className="grid gap-3 md:grid-cols-3">
        <div><div className="mb-1 text-sm text-muted">Candidatura A (eixo roxo)</div>
          <CandidatePicker id="pick-a" base={B} onPick={(c) => set("a", String(c.id))} placeholder={a ? nomeCand(a) : "Escolher…"} /></div>
        <div><div className="mb-1 text-sm text-muted">Candidatura B (eixo verde-azulado)</div>
          <CandidatePicker id="pick-b" base={B} onPick={(c) => set("b", String(c.id))} placeholder={b ? nomeCand(b) : "Escolher…"} /></div>
        <MunicipioSelect base={B} value={municipio} onChange={(cd) => set("mun", cd)} id="mun-dob" />
      </div>
      {votos.error && <ErrorBox error={votos.error} />}
      {!analise || !a || !b || !soma ? <Loading texto="Cruzando as candidaturas…" /> : (
        <>
          {municipio && (
            <Segmented label="Modo do mapa" value={modo} onChange={(m) => set("modo", m)}
              options={[{ id: "escolas", label: "Escolas" }, { id: "territorios", label: "Territórios" }]} />
          )}
          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <LazyMap base={B} dados={soma} municipio={municipio} modo={modo} metrica="votos" corPorLocal={corPorLocal}
              rotuloSerie="votos somados" onMunicipio={(cd) => set("mun", cd)} />
            <aside className="flex min-w-0 flex-col gap-4">
              <LegendaBivariada a={a} b={b} />
              <Dispersao analise={analise} a={a} b={b} />
              <Contagem analise={analise} />
            </aside>
          </div>
          <TabelaDobrada base={B} a={a} b={b} pa={pa!} pb={pb!} municipio={municipio} />
        </>
      )}
    </div>
  );
}

function LegendaBivariada({ a, b }: { a: Candidatura; b: Candidatura }) {
  return (
    <div className="flex items-end gap-3" aria-label="Legenda bivariada">
      <div className="grid grid-cols-3" style={{ width: 96 }}>
        {[2, 1, 0].map((ia) => [0, 1, 2].map((ib) => (
          <span key={`${ia}${ib}`} className="h-8" style={{ background: cssRgb(BIVAR[ia][ib]) }}
            title={`${a.nome}: ${NIVEL_TXT[ia]} · ${b.nome}: ${NIVEL_TXT[ib]}`} />
        )))}
      </div>
      <div className="text-xs text-muted">
        <div>↑ {a.nome} ({CARGOS[a.cargo]})</div>
        <div>→ {b.nome} ({CARGOS[b.cargo]})</div>
        <div className="mt-1">canto escuro = as duas fortes</div>
      </div>
    </div>
  );
}

function Contagem({ analise }: { analise: { classe: Int8Array } }) {
  const n = new Array(9).fill(0);
  analise.classe.forEach((k) => { if (k >= 0) n[k]++; });
  const total = n.reduce((x, y) => x + y, 0) || 1;
  const linhas = [
    { k: 8, t: "As duas fortes" }, { k: 6, t: "Só A forte" }, { k: 2, t: "Só B forte" }, { k: 0, t: "As duas fracas" },
  ];
  return (
    <ul className="text-sm">
      {linhas.map(({ k, t }) => (
        <li key={k} className="flex items-center gap-2 border-b border-line py-1">
          <span className="h-3 w-3 rounded-sm" style={{ background: cssRgb(BIVAR[Math.floor(k / 3)][k % 3]) }} />
          {t}<span className="num ml-auto">{fmt(n[k])} locais · {pct(n[k] / total, 0)}</span>
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
    ctx.fillText(`${b.nome} (% válidos) →`, pad, H - 10);
    ctx.save(); ctx.translate(12, H - pad); ctx.rotate(-Math.PI / 2); ctx.fillText(`${a.nome} →`, 0, 0); ctx.restore();
    ctx.fillText(pct(mx, 1), W - 40, H - pad + 12);
    ctx.fillText(pct(my, 1), pad + 4, 12);
  }, [analise, a, b]);
  return <canvas ref={ref} className="h-56 w-full" role="img" aria-label={`Dispersão por local: % de ${a.nome} × % de ${b.nome}`} />;
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
    { id: "nome", accessorKey: "nome", header: nivel === "local" ? "Escola / local" : "Município",
      cell: (c) => <div><div className="font-semibold">{nivel === "local" ? c.row.original.nome : titulo(c.row.original.nome)}</div>
        {nivel === "local" && <div className="text-xs text-muted">{titulo(c.row.original.bairro ?? "")}</div>}</div> },
    { id: "va", accessorKey: "va", header: `${a.nome} (votos)`, cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    { id: "pa", accessorKey: "pa", header: `${a.nome} (%)`, cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
    { id: "vb", accessorKey: "vb", header: `${b.nome} (votos)`, cell: (c) => fmt(Number(c.getValue())), meta: { numeric: true } },
    { id: "pb", accessorKey: "pb", header: `${b.nome} (%)`, cell: (c) => pct(Number(c.getValue())), meta: { numeric: true } },
  ], [a, b, nivel]);
  const exportCols: ExportCol<LinhaD>[] = [
    { header: nivel === "local" ? "Local de votação" : "Município", value: (r) => r.nome },
    { header: "Município", value: (r) => r.municipio },
    { header: "Bairro", value: (r) => r.bairro ?? "" },
    { header: `${a.numero} ${a.nome} (votos)`, value: (r) => r.va, type: "number" },
    { header: `${a.numero} ${a.nome} (% válidos)`, value: (r) => r.pa, type: "percent" },
    { header: `${b.numero} ${b.nome} (votos)`, value: (r) => r.vb, type: "number" },
    { header: `${b.numero} ${b.nome} (% válidos)`, value: (r) => r.pb, type: "percent" },
  ];
  return (
    <DataTable data={linhas} columns={columns} exportCols={exportCols} nomeArquivo={`dobrada_${a.numero}_${b.numero}`}
      busca={(r) => `${r.nome} ${r.municipio} ${r.bairro ?? ""}`} initialSort={[{ id: "va", desc: true }]} />
  );
}
