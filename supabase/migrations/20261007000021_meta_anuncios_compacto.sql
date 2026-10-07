-- Resposta compacta dos anúncios de uma candidatura (painel Publicidade).
-- Em vez de repetir em cada anúncio a lista de cidades e o texto inteiro, manda dicionários:
--   locs   = localidades distintas; cada anúncio leva índices (+i incluída, -i excluída, base 1)
--   textos = textos distintos (corpo + títulos); cada anúncio leva o índice do seu texto
-- Os anúncios vão em colunas (arrays paralelos). O navegador remonta o mesmo formato de antes.

create or replace function public.meta_anuncios_compacto(p_candidatura_id integer)
returns json language sql stable security invoker set search_path = public as $$
  with ads as (
    select a.*, coalesce(a.textos::text, '') || '|' || coalesce(a.titulos_link::text, '') as chave_texto
    from meta_anuncios a
    where a.page_id in (select page_id from meta_vinculos where candidatura_id = p_candidatura_id and status_revisao <> 'rejeitado')
  ), t as (
    select chave_texto, min(textos::text) as textos, min(titulos_link::text) as titulos,
           row_number() over (order by chave_texto) - 1 as ti
    from ads group by chave_texto
  ), l as (
    select l.ad_id, l.ordem, l.excluida,
           dense_rank() over (order by l.nivel, l.tipo, l.uf, l.municipio_nome, l.cd_ibge, l.cd_municipio, l.bairro_nome,
                                       l.cep_prefixo, l.status, l.nome_original) as li,
           l.nivel, l.tipo, l.uf, l.municipio_nome, l.cd_ibge, l.cd_municipio, l.bairro_nome, l.cep_prefixo, l.status, l.nome_original
    from meta_localidades l join ads using (ad_id)
  ), la as (
    select ad_id, json_agg(case when excluida then -li else li end order by ordem) as idx from l group by ad_id
  ), e as (
    select ad_id, json_agg(json_build_array(coalesce(uf, regiao), proporcao) order by proporcao desc) as ent
    from meta_entrega_regional where ad_id in (select ad_id from ads) group by ad_id
  ), x as (
    select a.*, t.ti, la.idx, e.ent from ads a join t using (chave_texto) left join la using (ad_id) left join e using (ad_id)
  )
  select json_build_object(
    'locs', (select coalesce(json_agg(json_build_array(nivel, tipo, uf, municipio_nome, cd_ibge, cd_municipio, bairro_nome,
                                                       cep_prefixo, status, nome_original) order by li), '[]')
             from (select distinct on (li) * from l order by li) d),
    'textos', (select coalesce(json_agg(json_build_array(textos::json, titulos::json) order by ti), '[]') from t),
    'id', coalesce(json_agg(x.ad_id order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'page_id', coalesce(json_agg(x.page_id order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'page_name', coalesce(json_agg(x.page_name order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'bylines', coalesce(json_agg(x.bylines order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'criado', coalesce(json_agg(x.criado_em order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'inicio', coalesce(json_agg(x.inicio_veiculacao order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'fim', coalesce(json_agg(x.fim_veiculacao order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'texto', coalesce(json_agg(x.ti order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'plataformas', coalesce(json_agg(x.plataformas order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'moeda', coalesce(json_agg(x.moeda order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'gmin', coalesce(json_agg(x.gasto_min order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'gmax', coalesce(json_agg(x.gasto_max order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'imin', coalesce(json_agg(x.impressoes_min order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'imax', coalesce(json_agg(x.impressoes_max order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'alcance', coalesce(json_agg(x.alcance_br order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'pmin', coalesce(json_agg(x.publico_estimado_min order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'pmax', coalesce(json_agg(x.publico_estimado_max order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'idades', coalesce(json_agg(x.idades_alvo order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'genero', coalesce(json_agg(x.genero_alvo order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'primeira', coalesce(json_agg(x.primeira_coleta order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'ultima', coalesce(json_agg(x.ultima_coleta order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'loc', coalesce(json_agg(coalesce(x.idx, '[]'::json) order by x.inicio_veiculacao desc, x.ad_id), '[]'),
    'entrega', coalesce(json_agg(coalesce(x.ent, '[]'::json) order by x.inicio_veiculacao desc, x.ad_id), '[]')
  ) from x;
$$;
grant execute on function public.meta_anuncios_compacto(integer) to authenticated;
