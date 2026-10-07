-- Comparativo das candidaturas prioritárias (candidaturas_destaque, todas as UFs): anúncios, gasto e base do custo por
-- mil alcançados, separados em próprio (páginas da candidatura) e dobradas (anúncios de outras campanhas que citam a
-- candidatura com nome e número; mesmo critério da faixa de gasto do painel). Custo = soma do gasto ÷ soma do alcance dos
-- anúncios em BRL com alcance > 0 (o navegador divide e multiplica por mil).

create or replace function public.meta_prioritarias_json()
returns json language sql stable security invoker set search_path = public as $$
  with d as (
    select c.id, c.uf, c.nm_urna, c.cd_cargo, c.sg_partido, c.votos_total, c.situacao, cd.ordem
    from candidaturas_destaque cd join candidaturas c on c.id = cd.candidatura_id
  ), paginas as (
    select v.candidatura_id, v.page_id from meta_vinculos v
    where v.status_revisao <> 'rejeitado' and v.candidatura_id in (select id from d)
  ), prop as (
    select p.candidatura_id, a.* from paginas p join meta_anuncios a on a.page_id = p.page_id
  ), dob as (
    select distinct on (m.candidatura_id, a.ad_id) m.candidatura_id, a.*
    from meta_mencoes m join meta_anuncios a using (ad_id)
    where m.candidatura_id in (select id from d) and m.cita_numero
      and m.pagador_candidatura_id is distinct from m.candidatura_id
      and a.page_id not in (select page_id from paginas p where p.candidatura_id = m.candidatura_id)
  ), agg as (
    select 'prop' as fonte, candidatura_id, count(*) as n, sum(gasto_min) as gmin, sum(gasto_max) as gmax, bool_or(gasto_max is null) as aberto,
           sum(gasto_min) filter (where moeda = 'BRL' and alcance_br > 0) as cgmin,
           sum(gasto_max) filter (where moeda = 'BRL' and alcance_br > 0) as cgmax,
           bool_or(gasto_max is null) filter (where moeda = 'BRL' and alcance_br > 0) as caberto,
           sum(alcance_br) filter (where moeda = 'BRL' and alcance_br > 0) as alcance
    from prop group by candidatura_id
    union all
    select 'dob', candidatura_id, count(*), sum(gasto_min), sum(gasto_max), bool_or(gasto_max is null),
           sum(gasto_min) filter (where moeda = 'BRL' and alcance_br > 0),
           sum(gasto_max) filter (where moeda = 'BRL' and alcance_br > 0),
           bool_or(gasto_max is null) filter (where moeda = 'BRL' and alcance_br > 0),
           sum(alcance_br) filter (where moeda = 'BRL' and alcance_br > 0)
    from dob group by candidatura_id
  )
  select coalesce(json_agg(json_build_object(
    'id', d.id, 'uf', d.uf, 'nome', d.nm_urna, 'cargo', d.cd_cargo, 'partido', d.sg_partido, 'votos', d.votos_total, 'situacao', d.situacao,
    'prop', (select row_to_json(x) from (select n, gmin, gmax, aberto, cgmin, cgmax, caberto, alcance from agg where agg.fonte = 'prop' and agg.candidatura_id = d.id) x),
    'dob', (select row_to_json(x) from (select n, gmin, gmax, aberto, cgmin, cgmax, caberto, alcance from agg where agg.fonte = 'dob' and agg.candidatura_id = d.id) x)
  ) order by d.uf, d.ordem), '[]')
  from d;
$$;
grant execute on function public.meta_prioritarias_json() to authenticated;
