-- Aba "Apocalipse": esquerda × extrema direita. O agrupamento em blocos é feito no navegador (ajustável); aqui ficam os
-- votos por cidade, partido e cargo (nominal + legenda) e os votos válidos por cidade e cargo, pré-calculados por UF.
-- Também: temas dos criativos por candidatura (calculados na carga, mesma taxonomia do painel) e, no resumo da
-- Publicidade, as somas que permitem custo por mil alcançados por bloco.

create table if not exists public.apocalipse_cache (
  uf        char(2) primary key,
  payload   json not null,
  gerado_em timestamptz not null default now()
);
alter table public.apocalipse_cache enable row level security;
drop policy if exists "equipe le" on public.apocalipse_cache;
create policy "equipe le" on public.apocalipse_cache for select to authenticated using ((select public.autorizado()));

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
        'validos', coalesce(json_agg(validos order by cd_cargo, cd_municipio), '[]')) from t)
  ), now())
  on conflict (uf) do update set payload = excluded.payload, gerado_em = excluded.gerado_em;
$$;
revoke execute on function public.apocalipse_atualizar(char) from public, anon, authenticated;

create or replace function public.apocalipse_json(p_uf char(2))
returns json language sql stable security invoker set search_path = public as $$
  select payload from apocalipse_cache where uf = p_uf;
$$;
grant execute on function public.apocalipse_json(char) to authenticated;

-- temas dos criativos por candidatura (anúncios próprios; criativos distintos = página + texto)
create table if not exists public.meta_temas_cand (
  candidatura_id integer not null references public.candidaturas on delete cascade,
  tema           text not null,
  criativos      integer not null,
  anuncios       integer not null,
  total_criativos integer not null,
  primary key (candidatura_id, tema)
);
alter table public.meta_temas_cand enable row level security;
drop policy if exists "equipe le" on public.meta_temas_cand;
create policy "equipe le" on public.meta_temas_cand for select to authenticated using ((select public.autorizado()));

create or replace function public.meta_temas_json(p_uf char(2))
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'cand', coalesce(json_agg(t.candidatura_id order by t.candidatura_id, t.tema), '[]'),
    'tema', coalesce(json_agg(t.tema order by t.candidatura_id, t.tema), '[]'),
    'criativos', coalesce(json_agg(t.criativos order by t.candidatura_id, t.tema), '[]'),
    'anuncios', coalesce(json_agg(t.anuncios order by t.candidatura_id, t.tema), '[]'),
    'total', coalesce(json_agg(t.total_criativos order by t.candidatura_id, t.tema), '[]'))
  from meta_temas_cand t join candidaturas c on c.id = t.candidatura_id where c.uf = p_uf;
$$;
grant execute on function public.meta_temas_json(char) to authenticated;
