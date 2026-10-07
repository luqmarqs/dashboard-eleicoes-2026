-- Histórico de candidaturas (2022) para comparação com 2026, por cidade, bairro e escola.
-- Gerado por scripts/historico_2022.py a partir dos dados abertos do TSE.

create table if not exists public.historico_candidatura (
  candidatura_id integer not null references public.candidaturas on delete cascade,  -- candidatura 2026
  ano            smallint not null,
  cd_cargo       smallint not null,   -- cargo naquele ano (ex.: Cortez era dep. estadual em 2022)
  numero         integer not null,
  votos_total    integer not null,
  primary key (candidatura_id, ano)
);

create table if not exists public.historico_votos (
  candidatura_id integer not null references public.candidaturas on delete cascade,
  ano            smallint not null,
  nivel          text not null check (nivel in ('municipio', 'bairro', 'local')),
  cd_municipio   char(5) not null,
  chave          text not null,       -- municipio: código TSE; bairro: "cd|BAIRRO"; local: id do local de 2026
  votos          integer not null,
  validos        integer not null,    -- votos válidos do cargo daquele ano no mesmo recorte
  primary key (candidatura_id, ano, nivel, chave)
);

alter table public.historico_candidatura enable row level security;
alter table public.historico_votos enable row level security;
drop policy if exists "equipe le" on public.historico_candidatura;
create policy "equipe le" on public.historico_candidatura for select to authenticated using ((select public.autorizado()));
drop policy if exists "equipe le" on public.historico_votos;
create policy "equipe le" on public.historico_votos for select to authenticated using ((select public.autorizado()));

create or replace function public.historico_json(p_candidatura_id integer)
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'resumo', (select coalesce(json_agg(h order by h.ano), '[]') from historico_candidatura h
               where h.candidatura_id = p_candidatura_id),
    'nivel', coalesce(json_agg(v.nivel order by v.nivel, v.chave), '[]'),
    'mun', coalesce(json_agg(v.cd_municipio order by v.nivel, v.chave), '[]'),
    'chave', coalesce(json_agg(v.chave order by v.nivel, v.chave), '[]'),
    'votos', coalesce(json_agg(v.votos order by v.nivel, v.chave), '[]'),
    'validos', coalesce(json_agg(v.validos order by v.nivel, v.chave), '[]'),
    'ano', coalesce(json_agg(v.ano order by v.nivel, v.chave), '[]'))
  from historico_votos v
  where v.candidatura_id = p_candidatura_id;
$$;
revoke execute on function public.historico_json(integer) from public, anon;
grant execute on function public.historico_json(integer) to authenticated;
