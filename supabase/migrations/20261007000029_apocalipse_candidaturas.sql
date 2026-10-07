-- Apocalipse: classificação por candidatura, por cima do padrão do partido. Fontes: voto nominal na urgência da anistia
-- aos réus do 8 de janeiro (Câmara, 17/09/2025) e curadoria com fonte pública (config/apocalipse_candidaturas.json).
-- O cache passa a levar, além dos votos por partido, os votos por cidade dessas candidaturas, para o navegador poder
-- tirá-las do bloco do partido e pô-las no bloco delas.

create table if not exists public.apocalipse_cand (
  uf         char(2) not null,
  cd_cargo   smallint not null,
  numero     integer not null,
  nome       text not null,
  bloco      text not null check (bloco in ('esquerda', 'centrao', 'extrema', 'demais')),
  criterio   text not null,
  evidencia  text not null,
  fonte      text,
  primary key (uf, cd_cargo, numero)
);
alter table public.apocalipse_cand enable row level security;
drop policy if exists "equipe le" on public.apocalipse_cand;
create policy "equipe le" on public.apocalipse_cand for select to authenticated using ((select public.autorizado()));

create or replace function public.apocalipse_atualizar(p_uf char(2))
returns void language sql security definer set search_path = public as $$
  with v as (
    select c.cd_cargo, l.cd_municipio, coalesce(nullif(c.sg_partido, ''), '?') as partido, sum(u.q)::bigint as votos
    from candidaturas c
    join votos_cand vc on vc.candidatura_id = c.id
    cross join lateral unnest(vc.locais, vc.votos) as u(l, q)
    join locais l on l.id = u.l
    where c.uf = p_uf and c.cd_cargo in (1, 3, 5, 6, 7)
    group by 1, 2, 3
  ), t as (
    select tl.cd_cargo, l.cd_municipio, sum(tl.validos)::bigint as validos
    from totais_local tl join locais l on l.id = tl.local_id
    where l.uf = p_uf and tl.cd_cargo in (1, 3, 5, 6, 7)
    group by 1, 2
  ), k as (
    select c.id, c.cd_cargo, c.numero, a.nome, a.bloco, a.criterio, a.evidencia, a.fonte
    from apocalipse_cand a
    join candidaturas c on c.uf = a.uf and c.cd_cargo = a.cd_cargo and c.numero = a.numero and c.tipo = 'nominal'
    where a.uf = p_uf
  ), kv as (
    select k.id, l.cd_municipio, sum(u.q)::bigint as votos
    from k join votos_cand vc on vc.candidatura_id = k.id
    cross join lateral unnest(vc.locais, vc.votos) as u(l, q)
    join locais l on l.id = u.l
    group by 1, 2
  )
  insert into apocalipse_cache values (p_uf, json_build_object(
    'votos', (select json_build_object(
        'cargo', coalesce(json_agg(cd_cargo order by cd_cargo, cd_municipio, partido), '[]'),
        'mun', coalesce(json_agg(cd_municipio order by cd_cargo, cd_municipio, partido), '[]'),
        'partido', coalesce(json_agg(partido order by cd_cargo, cd_municipio, partido), '[]'),
        'votos', coalesce(json_agg(votos order by cd_cargo, cd_municipio, partido), '[]')) from v),
    'validos', (select json_build_object(
        'cargo', coalesce(json_agg(cd_cargo order by cd_cargo, cd_municipio), '[]'),
        'mun', coalesce(json_agg(cd_municipio order by cd_cargo, cd_municipio), '[]'),
        'validos', coalesce(json_agg(validos order by cd_cargo, cd_municipio), '[]')) from t),
    'classif', (select coalesce(json_agg(json_build_object('id', id, 'cargo', cd_cargo, 'numero', numero, 'nome', nome, 'bloco', bloco,
        'criterio', criterio, 'evidencia', evidencia, 'fonte', fonte) order by id), '[]') from k),
    'cand', (select json_build_object(
        'id', coalesce(json_agg(id order by id, cd_municipio), '[]'),
        'mun', coalesce(json_agg(cd_municipio order by id, cd_municipio), '[]'),
        'votos', coalesce(json_agg(votos order by id, cd_municipio), '[]')) from kv)
  ), now())
  on conflict (uf) do update set payload = excluded.payload, gerado_em = excluded.gerado_em;
$$;
revoke execute on function public.apocalipse_atualizar(char) from public, anon, authenticated;
