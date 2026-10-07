-- Dobradas pagas: anúncios de uma campanha que citam outra candidatura (nome + número de urna).
-- O gasto do anúncio é de quem pagou (financiador declarado); nunca é somado ao da candidatura citada.

create table if not exists public.meta_mencoes (
  ad_id                  text not null references public.meta_anuncios on delete cascade,
  candidatura_id         integer not null references public.candidaturas on delete cascade,  -- citada
  pagador_candidatura_id integer references public.candidaturas on delete set null,           -- dona do CNPJ do financiador
  cita_nome              boolean not null,
  cita_numero            boolean not null,
  cnpjs_texto            text,       -- CNPJs escritos no criativo (só dígitos, separados por vírgula)
  cnpj_financiador       text,       -- CNPJ que aparece no próprio financiador declarado
  confirmada             boolean not null,  -- nome + número + pagador identificado e diferente da citada
  primary key (ad_id, candidatura_id)
);
create index if not exists meta_mencoes_cand on public.meta_mencoes (candidatura_id);
create index if not exists meta_mencoes_pag on public.meta_mencoes (pagador_candidatura_id);

alter table public.meta_mencoes enable row level security;
drop policy if exists "equipe le" on public.meta_mencoes;
create policy "equipe le" on public.meta_mencoes for select to authenticated using ((select public.autorizado()));

create or replace function public.meta_anuncio_obj(a public.meta_anuncios)
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'id', a.ad_id, 'page_id', a.page_id, 'page_name', a.page_name, 'bylines', a.bylines,
    'criado', a.criado_em, 'inicio', a.inicio_veiculacao, 'fim', a.fim_veiculacao,
    'textos', a.textos, 'titulos', a.titulos_link, 'plataformas', a.plataformas, 'moeda', a.moeda,
    'gasto', json_build_array(a.gasto_min, a.gasto_max), 'impressoes', json_build_array(a.impressoes_min, a.impressoes_max),
    'alcance', a.alcance_br, 'publico', json_build_array(a.publico_estimado_min, a.publico_estimado_max),
    'idades', a.idades_alvo, 'genero', a.genero_alvo, 'link', a.link_biblioteca,
    'primeira_coleta', a.primeira_coleta, 'ultima_coleta', a.ultima_coleta,
    'loc', (select coalesce(json_agg(json_build_array(l.nivel, l.tipo, l.excluida, l.uf, l.municipio_nome, l.cd_ibge,
              l.cd_municipio, l.bairro_nome, l.cep_prefixo, l.status, l.nome_original) order by l.ordem), '[]')
            from meta_localidades l where l.ad_id = a.ad_id),
    'entrega', (select coalesce(json_agg(json_build_array(coalesce(e.uf, e.regiao), e.proporcao) order by e.proporcao desc), '[]')
                from meta_entrega_regional e where e.ad_id = a.ad_id));
$$;

-- Menções que envolvem a candidatura: 'recebe' = outras campanhas citam ela; 'faz' = anúncios das páginas dela citam outras.
create or replace function public.meta_dobradas_json(p_candidatura_id integer)
returns json language sql stable security invoker set search_path = public as $$
  with proprias as (
    select page_id from meta_vinculos where candidatura_id = p_candidatura_id and status_revisao <> 'rejeitado'
  ), m as (
    select 'recebe' as papel, mm.*, mm.pagador_candidatura_id as outra
    from meta_mencoes mm
    where mm.candidatura_id = p_candidatura_id and mm.pagador_candidatura_id is distinct from p_candidatura_id
      and mm.ad_id not in (select ad_id from meta_anuncios where page_id in (select page_id from proprias))
    union all
    select 'faz', mm.*, mm.candidatura_id
    from meta_mencoes mm join meta_anuncios a using (ad_id)
    where a.page_id in (select page_id from proprias) and mm.candidatura_id <> p_candidatura_id and mm.cita_numero
  )
  select coalesce(json_agg(json_build_object(
    'papel', m.papel, 'outra', m.outra, 'cita_nome', m.cita_nome, 'cita_numero', m.cita_numero,
    'confirmada', m.confirmada, 'cnpjs_texto', m.cnpjs_texto, 'cnpj_financiador', m.cnpj_financiador,
    'ad', meta_anuncio_obj(a)) order by a.inicio_veiculacao desc), '[]')
  from m join meta_anuncios a using (ad_id);
$$;

grant execute on function public.meta_anuncio_obj(public.meta_anuncios), public.meta_dobradas_json(integer) to authenticated;
