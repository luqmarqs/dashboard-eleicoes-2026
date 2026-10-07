-- Cobertura do resumo = última coleta das páginas (a busca de menções/dobradas não é coleta de páginas).
create or replace function public.meta_resumo_json(p_uf char(2))
returns json language sql stable security invoker set search_path = public as $$
  with v as (
    select * from meta_vinculos where uf = p_uf and status_revisao <> 'rejeitado'
  ), a as (
    select v.candidatura_id, count(distinct an.ad_id) as anuncios,
           sum(an.gasto_min) as gasto_min, sum(an.gasto_max) as gasto_max,
           bool_or(an.gasto_max is null and an.ad_id is not null) as gasto_aberto,
           count(distinct an.moeda) as moedas, max(an.ultima_coleta) as ultima_coleta
    from v left join meta_anuncios an on an.page_id = v.page_id
    group by v.candidatura_id
  )
  select json_build_object(
    'execucao', (select row_to_json(e) from meta_execucoes e where e.modo <> 'mencoes' order by iniciada_em desc limit 1),
    'ultima_completa', (select max(iniciada_em) from meta_execucoes where status = 'completa' and modo <> 'mencoes'),
    'candidaturas', coalesce((
      select json_agg(json_build_object(
        'candidatura_id', c.candidatura_id,
        'paginas', (select json_agg(json_build_object('page_id', page_id, 'page_name', page_name, 'natureza', natureza,
                    'status_revisao', status_revisao, 'evidencia', evidencia, 'coletar', coletar) order by page_name)
                    from v where v.candidatura_id = c.candidatura_id),
        'anuncios', a.anuncios, 'gasto_min', a.gasto_min, 'gasto_max', a.gasto_max, 'gasto_aberto', a.gasto_aberto,
        'moedas', a.moedas, 'ultima_coleta', a.ultima_coleta) order by a.gasto_max desc nulls last)
      from (select distinct candidatura_id from v) c join a using (candidatura_id)), '[]')
  );
$$;
