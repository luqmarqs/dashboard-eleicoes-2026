import { useMemo } from "react";
import { titulo } from "./format";
import { L } from "./i18n";
import { useBase, useTotais, useVotos, type Base } from "./data";
import type { Candidatura, TotaisCols, VotosCols } from "./types";

/*
 * Base comum das abas "Ainda há esperança" e "Apocalipse": Lula × adversário do 2º turno por cidade/bairro, com abstenção,
 * e onde cada candidatura nossa tem base. Saldo potencial = MOBILIZACAO × abstenções × (válidos/comparecimento) × margem.
 */

// candidaturas do PSOL em que a equipe atua (UF -> cargo:número)
export const NOSSAS: Record<string, string[]> = {
  SP: ["6:5005", "7:50000"],
  MG: ["7:50099"],
  RS: ["7:50123", "5:500"],
};
export const MOBILIZACAO = 0.1; // cenário: 10% dos abstencionistas passam a votar

export type Faixa = "mobilizar" | "disputar" | "conter";
export interface Terr {
  chave: string; cidade: string; cd: string; bairro?: string; locais: number;
  aptos: number; comp: number; validos: number; lula: number; adv: number;
}
export interface Linha extends Terr { abst: number; taxaAbst: number; sL: number; sA: number; margem: number; saldo: number; faixa: Faixa }
export interface LinhaNossa extends Linha { votosC: number; indice: number; score: number }

export const NOME_FAIXA = (f: Faixa) => (f === "mobilizar" ? L("Mobilizar", "Mobilize") : f === "disputar" ? L("Disputar", "Contest") : L("Conter", "Contain"));

export const linha = (t: Terr, medianaAbst: number): Linha => {
  const abst = t.aptos - t.comp, taxaAbst = t.aptos ? abst / t.aptos : 0;
  const sL = t.validos ? t.lula / t.validos : 0, sA = t.validos ? t.adv / t.validos : 0, margem = sL - sA;
  const saldo = MOBILIZACAO * abst * (t.comp ? t.validos / t.comp : 0) * margem;
  const faixa: Faixa = margem >= 0.1 && taxaAbst >= medianaAbst ? "mobilizar" : Math.abs(margem) < 0.1 ? "disputar" : margem > 0 ? "mobilizar" : "conter";
  return { ...t, abst, taxaAbst, sL, sA, margem, saldo, faixa };
};

const nomeBairro = (b: string) => titulo((b || L("sem bairro", "no neighbourhood")).trim());
export const chaveBairro = (base: Base, localId: number) => {
  const l = base.localById.get(localId);
  return l ? `${l.mun}|${nomeBairro(l.bairro).toUpperCase()}` : null;
};

export function agrega(base: Base, totais: TotaisCols, vl: VotosCols, va: VotosCols, porBairro: boolean): Map<string, Terr> {
  const m = new Map<string, Terr>();
  const pega = (localId: number) => {
    const l = base.localById.get(localId);
    if (!l) return null;
    const b = porBairro ? nomeBairro(l.bairro) : undefined;
    const k = porBairro ? `${l.mun}|${b!.toUpperCase()}` : l.mun;
    let t = m.get(k);
    if (!t) { t = { chave: k, cidade: titulo(l.munNome), cd: l.mun, bairro: b, locais: 0, aptos: 0, comp: 0, validos: 0, lula: 0, adv: 0 }; m.set(k, t); }
    return t;
  };
  totais.local.forEach((id, i) => { const t = pega(id); if (t) { t.locais++; t.aptos += totais.aptos[i]; t.comp += totais.comparecimento[i]; t.validos += totais.validos[i]; } });
  vl.local.forEach((id, i) => { const t = pega(id); if (t) t.lula += vl.votos[i]; });
  va.local.forEach((id, i) => { const t = pega(id); if (t) t.adv += va.votos[i]; });
  return m;
}

/** Lula e o adversário do 2º turno na UF. */
export function useDuelo() {
  const base = useBase();
  const lula = base.data?.candidaturas.find((c) => c.cargo === 1 && c.numero === 13);
  const adv = base.data?.candidaturas.filter((c) => c.cargo === 1 && c.tipo === "nominal" && c.numero !== 13)
    .sort((a, b) => (Number(b.situacao === "2º turno") - Number(a.situacao === "2º turno")) || b.votos - a.votos)[0];
  const votos = useVotos(lula && adv ? [lula.id, adv.id] : []);
  const totais = useTotais(1);
  return { base, lula, adv, votos, totais, error: base.error ?? votos.error ?? totais.error };
}

/** Bairros (500+ eleitores) com Lula × adversário, abstenção e saldo; mediana de abstenção por local. */
export function useBairrosDuelo(base: Base | undefined, lula?: Candidatura, adv?: Candidatura, votos?: Record<number, VotosCols>, totais?: TotaisCols) {
  return useMemo(() => {
    if (!base || !lula || !adv || !votos || !totais) return null;
    const vazio = { local: [], votos: [] };
    const vl = votos[lula.id] ?? vazio, va = votos[adv.id] ?? vazio;
    const xs = totais.local.map((_, i) => (totais.aptos[i] ? (totais.aptos[i] - totais.comparecimento[i]) / totais.aptos[i] : 0)).sort((a, b) => a - b);
    const medianaAbst = xs.length ? xs[Math.floor(xs.length / 2)] : 0;
    const bairros = [...agrega(base, totais, vl, va, true).values()].filter((t) => t.aptos >= 500).map((t) => linha(t, medianaAbst));
    return { bairros, medianaAbst, vl, va };
  }, [base, lula, adv, votos, totais]);
}

/** Bairros onde a candidatura tem base (≥1,2× a sua média no estado e 100+ votos), com o duelo Lula × adversário. */
export function useBaseCandidatura(base: Base, c: Candidatura, bairros: Linha[]) {
  const v = useVotos([c.id]);
  const t = useTotais(c.cargo);
  const r = useMemo(() => {
    const vc = v.data?.[c.id];
    if (!vc || !t.data) return null;
    const val = new Map<string, number>(), vot = new Map<string, number>();
    t.data.local.forEach((id, i) => { const k = chaveBairro(base, id); if (k) val.set(k, (val.get(k) ?? 0) + t.data!.validos[i]); });
    vc.local.forEach((id, i) => { const k = chaveBairro(base, id); if (k) vot.set(k, (vot.get(k) ?? 0) + vc.votos[i]); });
    const totVal = [...val.values()].reduce((a, x) => a + x, 0), totC = [...vot.values()].reduce((a, x) => a + x, 0);
    const media = totVal ? totC / totVal : 0;
    // votos da candidatura em bairros onde Lula ficou à frente (todos os bairros com 500+ eleitores), sobre o total dela
    const emLula = bairros.reduce((a, b) => (b.margem > 0 ? a + (vot.get(b.chave) ?? 0) : a), 0);
    const linhas: LinhaNossa[] = bairros.map((b) => {
      const vC = vot.get(b.chave) ?? 0, vv = val.get(b.chave) ?? 0;
      const indice = media && vv ? vC / vv / media : 0;
      return { ...b, votosC: vC, indice, score: Math.max(b.saldo, 0) * Math.min(indice, 3) };
    }).filter((b) => b.indice >= 1.2 && b.votosC >= 100);
    return { linhas, shareLula: totC ? emLula / totC : 0 };
  }, [v.data, t.data, base, c, bairros]);
  return { linhas: r?.linhas ?? null, shareLula: r?.shareLula ?? null, loading: v.isLoading || t.isLoading, error: v.error ?? t.error };
}

export function nossasDaUf(base: Base, uf: string): Candidatura[] {
  return (NOSSAS[uf] ?? []).map((k) => { const [cg, n] = k.split(":").map(Number); return base.candidaturas.find((c) => c.cargo === cg && c.numero === n && c.tipo === "nominal"); })
    .filter((c): c is Candidatura => !!c);
}
