import type { Base } from "./data";
import { normalizar } from "./format";
import type { Candidatura } from "./types";

/**
 * Candidatura PROVÁVEL de uma página cujo financiador não é o CNPJ de campanha: o nome da página é exatamente um nome
 * de urna da UF (aceita o número no fim, ex.: "Matheus Gomes 50123"), e só uma candidatura tem esse nome.
 * É indício, não confirmação: aparece sempre rotulado como "provável".
 */
const cache = new WeakMap<Base, Map<string, Candidatura[]>>();

export function candidaturaProvavel(base: Base, pageName: string | null | undefined): Candidatura | undefined {
  if (!pageName) return undefined;
  let idx = cache.get(base);
  if (!idx) {
    idx = new Map();
    for (const c of base.candidaturas) {
      if (c.tipo !== "nominal" || !c.nome) continue;
      const k = normalizar(c.nome).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      idx.set(k, [...(idx.get(k) ?? []), c]);
    }
    cache.set(base, idx);
  }
  const p = normalizar(pageName).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const semNumero = p.replace(/\s\d{2,5}$/, "");
  const achados = idx.get(p) ?? idx.get(semNumero) ?? [];
  return achados.length === 1 ? achados[0] : undefined;
}
