import { useQuery } from "@tanstack/react-query";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { source, type MetaAnuncio } from "./source";
import { useUf } from "./uf";

/** Resumo do painel Publicidade da UF (candidaturas com página, cobertura). */
export function useMetaResumo() {
  const { uf } = useUf();
  return useQuery({ queryKey: ["meta-resumo", uf], queryFn: () => source.metaResumo(), staleTime: 5 * 60_000 });
}

/** Anúncios de uma candidatura; guardados no IndexedDB até haver coleta nova (versão = última coleta da candidatura). */
export function useMetaAnuncios(id: number | undefined, versao: string | null | undefined, ativo = true) {
  const { uf } = useUf();
  return useQuery({
    queryKey: ["meta-anuncios", uf, id, versao],
    queryFn: async () => {
      const chave = `meta-${uf}-${id}-${versao ?? "x"}`;
      try {
        const c = await idbGet<MetaAnuncio[]>(chave);
        if (c) return c;
      } catch { /* sem IndexedDB */ }
      const ads = await source.metaAnuncios(id!);
      try { await idbSet(chave, ads); } catch { /* ignora */ }
      return ads;
    },
    enabled: id != null && ativo, staleTime: Infinity, gcTime: 30 * 60_000,
  });
}
