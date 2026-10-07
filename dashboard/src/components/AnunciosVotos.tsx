import { useMemo } from "react";
import type { Base, LinhaAgregada } from "../lib/data";
import { fmt, pct, titulo } from "../lib/format";
import { porMunicipio } from "../lib/meta";
import type { MetaAnuncio } from "../lib/source";

/*
 * Anúncios × votos por cidade (descritivo). Para cada município da UF:
 *   intensidade = anúncios da candidatura que incluem a cidade (inteira ou um bairro dela) na segmentação;
 *   votação     = % dos votos válidos do cargo na cidade (normaliza o tamanho da cidade).
 * Correlação de postos de Spearman entre as duas, e faixas de intensidade. Anúncios para o estado inteiro não
 * entram (não dizem nada sobre cidades). Não mede efeito: campanhas anunciam onde já são fortes.
 */

interface Faixa { id: string; rotulo: string; min: number; max: number }

/** Faixas adaptadas à candidatura: um valor por faixa se houver poucos; senão, tercis das cidades segmentadas. */
function faixasPara(ns: number[]): Faixa[] {
  const out: Faixa[] = [{ id: "0", rotulo: "Nenhum anúncio", min: 0, max: 0 }];
  const pos = ns.filter((n) => n > 0).sort((a, b) => a - b);
  if (!pos.length) return out;
  const distintos = [...new Set(pos)];
  const rot = (a: number, b: number) => (a === b ? `${a} anúncio${a > 1 ? "s" : ""}` : b === Infinity ? `${a} ou mais` : `${a} a ${b}`);
  if (distintos.length <= 4) {
    for (const v of distintos) out.push({ id: `v${v}`, rotulo: rot(v, v), min: v, max: v });
    return out;
  }
  const t1 = pos[Math.floor(pos.length / 3)], t2 = pos[Math.floor((2 * pos.length) / 3)];
  const cortes = [...new Set([t1, t2])].filter((c) => c < pos[pos.length - 1]);
  let ini = pos[0];
  for (const c of cortes) { out.push({ id: `f${ini}`, rotulo: rot(ini, c), min: ini, max: c }); ini = c + 1; }
  out.push({ id: `f${ini}`, rotulo: rot(ini, Infinity), min: ini, max: Infinity });
  return out;
}

function postos(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(v.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const medio = (i + j) / 2 + 1; // empates recebem o posto médio
    for (let k = i; k <= j; k++) r[idx[k][1]] = medio;
    i = j + 1;
  }
  return r;
}

export function spearman(x: number[], y: number[]): number {
  if (x.length < 5) return NaN;
  const rx = postos(x), ry = postos(y);
  const mx = rx.reduce((s, v) => s + v, 0) / rx.length, my = ry.reduce((s, v) => s + v, 0) / ry.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < rx.length; i++) { const a = rx[i] - mx, b = ry[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

const forca = (r: number) => (!Number.isFinite(r) ? "indefinida" : Math.abs(r) >= 0.5 ? "forte" : Math.abs(r) >= 0.3 ? "moderada" : Math.abs(r) >= 0.1 ? "fraca" : "praticamente nula");
const fmtR = (r: number) => (Number.isFinite(r) ? r.toFixed(2).replace(".", ",") : "–");

interface Ponto { cd: string; nome: string; n: number; votos: number; validos: number; pct: number }

export function AnunciosVotos({ base, ads, votosMun, nome, onMunicipio, deTerceiros = false }: {
  base: Base; ads: MetaAnuncio[]; votosMun: Map<string, LinhaAgregada>; nome: string; onMunicipio?: (cd: string) => void;
  /** anúncios pagos por outras campanhas que citam a candidatura (dobradas), em vez dos próprios */
  deTerceiros?: boolean;
}) {
  const r = useMemo(() => {
    const mun = porMunicipio(ads);
    const pts: Ponto[] = base.municipios.flatMap((m) => {
      const v = votosMun.get(m.cd);
      if (!v || !v.validos) return [];
      const x = mun.get(m.cd);
      const n = x ? new Set([...x.inclui, ...x.bairro]).size : 0;
      return [{ cd: m.cd, nome: m.nome, n, votos: v.votos, validos: v.validos, pct: v.pct }];
    });
    const total = pts.reduce((s, p) => s + p.votos, 0);
    const rho = spearman(pts.map((p) => p.n), pts.map((p) => p.pct));
    const alvo = pts.filter((p) => p.n > 0);
    const rhoAlvo = spearman(alvo.map((p) => p.n), alvo.map((p) => p.pct));
    const faixas = faixasPara(pts.map((p) => p.n)).map((f) => {
      const ps = pts.filter((p) => p.n >= f.min && p.n <= f.max);
      const votos = ps.reduce((s, p) => s + p.votos, 0), val = ps.reduce((s, p) => s + p.validos, 0);
      return { ...f, cidades: ps.length, votos, share: total ? votos / total : 0, pctVal: val ? votos / val : null };
    }).filter((f) => f.cidades > 0);
    return { pts, rho, rhoAlvo, nAlvo: alvo.length, faixas, total };
  }, [ads, base, votosMun]);

  if (!r.pts.length || !r.nAlvo) return null;
  const sem = r.faixas.find((f) => f.id === "0");
  const com = r.faixas.filter((f) => f.id !== "0");
  const topo = com[com.length - 1];
  return (
    <section aria-label="Anúncios e votos por cidade" className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <h3 className="display text-xl">Anúncios × votos por cidade</h3>
      <p className="text-sm leading-relaxed">
        Nas <b>{fmt(r.nAlvo)}</b> cidades que receberam anúncios segmentados {deTerceiros
          ? <>de <b>outras campanhas citando {titulo(nome)}</b> (dobradas; {titulo(nome)} não tem anúncios próprios na campanha)</>
          : <>de {titulo(nome)}</>}, a votação
        {topo && sem && topo.pctVal != null && sem.pctVal != null ? <> foi de <b>{pct(topo.pctVal)}</b> dos válidos na faixa com mais
          anúncios ({topo.rotulo.toLowerCase()}), contra <b>{pct(sem.pctVal)}</b> nas cidades sem nenhum anúncio.</> : " está detalhada abaixo."}
        {" "}Correlação de postos entre número de anúncios e % dos válidos: <b>{fmtR(r.rho)}</b> ({forca(r.rho)}) em todas as cidades;
        {" "}<b>{fmtR(r.rhoAlvo)}</b> ({forca(r.rhoAlvo)}) só entre as cidades com anúncio.
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted">
              <th className="py-1 pr-2">Anúncios que incluem a cidade</th><th className="pr-2 text-right">Cidades</th>
              <th className="pr-2 text-right">Votos</th><th className="pr-2 text-right">% do total</th><th className="text-right">% dos válidos</th>
            </tr></thead>
            <tbody>{r.faixas.map((f) => (
              <tr key={f.id} className="border-t border-line">
                <td className="py-1 pr-2">{f.rotulo}</td><td className="num pr-2 text-right">{fmt(f.cidades)}</td>
                <td className="num pr-2 text-right">{fmt(f.votos)}</td><td className="num pr-2 text-right">{pct(f.share, 1)}</td>
                <td className="num text-right">{f.pctVal != null ? pct(f.pctVal) : "–"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <Dispersao pts={r.pts} onMunicipio={onMunicipio} />
      </div>
      <p className="text-xs text-muted">
        Descritivo, não causal: campanhas costumam anunciar onde já têm base, e cidades grandes recebem mais anúncios. A correlação de
        postos (Spearman, de −1 a 1) mede se as cidades com mais anúncios tendem a ter maior % dos válidos. Conta só segmentação
        explícita por cidade ou bairro (anúncios para o estado inteiro não entram); segmentar não garante que o anúncio foi entregue ali.
      </p>
    </section>
  );
}

function Dispersao({ pts, onMunicipio }: { pts: Ponto[]; onMunicipio?: (cd: string) => void }) {
  const W = 520, H = 260, P = 44;
  const maxN = Math.max(1, ...pts.map((p) => p.n));
  const maxP = Math.max(0.0001, ...pts.map((p) => p.pct));
  const maxV = Math.max(1, ...pts.map((p) => p.validos));
  const sx = (n: number) => P + (Math.log10(n + 1) / Math.log10(maxN + 1)) * (W - P - 12);
  const sy = (v: number) => H - 28 - (v / maxP) * (H - 44);
  const ticksX = [...new Set([0, 1, 10, 100, 1000].filter((t) => t < maxN * 0.8).concat(maxN))];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Dispersão: anúncios que incluem a cidade × % dos válidos">
      {ticksX.map((t) => <g key={t}><line x1={sx(t)} x2={sx(t)} y1={12} y2={H - 28} stroke="var(--line)" /><text x={sx(t)} y={H - 12} fontSize="10" textAnchor="middle" fill="var(--muted)">{fmt(t)}</text></g>)}
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={P} x2={W - 12} y1={sy(maxP * f)} y2={sy(maxP * f)} stroke="var(--line)" /><text x={P - 4} y={sy(maxP * f) + 3} fontSize="10" textAnchor="end" fill="var(--muted)">{pct(maxP * f, 1)}</text></g>)}
      <text x={(W + P) / 2} y={H - 1} fontSize="10" textAnchor="middle" fill="var(--muted)">anúncios que incluem a cidade (escala log)</text>
      {pts.map((p) => (
        <circle key={p.cd} cx={sx(p.n)} cy={sy(p.pct)} r={1.5 + 6 * Math.sqrt(p.validos / maxV)} fill={p.n > 0 ? "var(--accent)" : "var(--muted)"}
          fillOpacity={0.55} className={onMunicipio ? "cursor-pointer" : undefined} onClick={() => onMunicipio?.(p.cd)}>
          <title>{`${titulo(p.nome)}: ${fmt(p.n)} anúncios · ${fmt(p.votos)} votos (${pct(p.pct)} dos válidos)`}</title>
        </circle>
      ))}
    </svg>
  );
}
