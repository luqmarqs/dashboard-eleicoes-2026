import { useMemo } from "react";
import { fmt, pct } from "../lib/format";
import { fmtFaixa } from "../lib/meta";
import type { MetaAnuncio } from "../lib/source";
import { EIXOS, contarTemas, rotuloDe } from "../lib/temas";
import { L, getLang } from "../lib/i18n";

/** Card "Temas dos criativos": parcela de criativos distintos por tema; clicar filtra mapa e anúncios. */
export function TemasCriativos({ ads, tema, onTema }: { ads: MetaAnuncio[]; tema: string | null; onTema: (t: string | null) => void }) {
  const c = useMemo(() => contarTemas(ads), [ads]);
  if (!c.criativos) return null;
  return (
    <section aria-label={L("Temas dos criativos", "Creative themes")} className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-xl">{L("Temas dos criativos", "Creative themes")}</h3>
        <span className="text-sm text-muted">
          {getLang() === "en" ? <>{fmt(c.criativos)} distinct creatives in {fmt(c.anuncios)} ads</> : <>{fmt(c.criativos)} criativos distintos em {fmt(c.anuncios)} anúncios</>}
          {tema && <> · <button type="button" className="text-accent" onClick={() => onTema(null)}>{L("limpar filtro de tema", "clear theme filter")}</button></>}
        </span>
      </div>
      {c.semPolitica / c.criativos >= 0.5 && (
        <p className="rounded-md border border-line bg-accent-soft px-3 py-2 text-sm">
          {L(`${pct(c.semPolitica / c.criativos, 0)} dos criativos não citam nenhuma política pública no texto (em geral só o pedido de voto). A mensagem desses anúncios está no vídeo ou na imagem, que esta classificação não lê: os percentuais abaixo descrevem só o texto escrito.`,
            `${pct(c.semPolitica / c.criativos, 0)} of creatives mention no public policy in their text (usually just a vote request). Their message is in the video or image, which this classification does not read: the shares below describe the written text only.`)}
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-3">
        {EIXOS.map((e) => {
          const linhas = e.temas.map((t) => ({ t, r: c.porTema.get(t.id) })).filter((x) => x.r).sort((a, b) => b.r!.criativos - a.r!.criativos);
          return (
            <div key={e.id}>
              <div className="eyebrow mb-1">{rotuloDe(e)}</div>
              {!linhas.length && <p className="text-sm text-muted">{L("nenhum", "none")}</p>}
              <ul className="flex flex-col gap-1">
                {linhas.slice(0, 8).map(({ t, r }) => {
                  const p = r!.criativos / c.criativos;
                  const ativo = tema === t.id;
                  return (
                    <li key={t.id}>
                      <button type="button" aria-pressed={ativo} onClick={() => onTema(ativo ? null : t.id)}
                        title={e.id === "politica_publica" ? `${L("Verba (dividida entre os temas de cada anúncio)", "Spend (split among each ad's themes)")}: ${fmtFaixa(r!.verbaMin, r!.verbaMax, "R$ ")}` : undefined}
                        className={`grid w-full grid-cols-[minmax(0,1fr)_64px_44px] items-center gap-2 rounded px-1 py-0.5 text-left text-sm ${ativo ? "bg-accent-soft font-semibold" : "hover:bg-accent-soft"}`}>
                        <span className="truncate">{rotuloDe(t)}</span>
                        <span className="h-2 rounded-sm bg-accent/70" style={{ width: `${Math.max(4, p * 100)}%` }} aria-hidden />
                        <span className="num text-right text-xs">{pct(p, 0)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        {getLang() === "en" ? <>
        % of distinct creatives (Page + text) that mention the theme; a creative can have several. {pct(c.semPolitica / c.criativos, 0)} do not
        address any public policy (e.g., only a vote request or endorsement). Hover over a policy theme to see the spend
        split among each ad's themes. Keyword-based classification (no AI), reviewed against the collected ads; legal footers
        (CNPJ, coalition) do not count. Click a theme to filter the map, cities and ads.
        </> : <>
        % dos criativos distintos (página + texto) que mencionam o tema; um criativo pode ter vários. {pct(c.semPolitica / c.criativos, 0)} não
        tratam de nenhuma política pública (ex.: só pedido de voto ou apoio). Passe o mouse num tema de política para ver a verba
        dividida entre os temas de cada anúncio. Classificação por termos (sem IA), revisada sobre os anúncios coletados; rodapés legais
        (CNPJ, federação) não contam. Clique num tema para filtrar mapa, cidades e anúncios.
        </>}
      </p>
    </section>
  );
}
