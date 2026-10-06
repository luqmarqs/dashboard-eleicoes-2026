-- Desempenho do carregamento dos painéis.

-- Versão dos dados: o navegador guarda a base (locais, candidaturas, municípios) em cache e só
-- baixa de novo quando esta versão muda (o carregador atualiza a cada carga).
create table if not exists public.meta (chave text primary key, valor text not null);
alter table public.meta enable row level security;
drop policy if exists "equipe le" on public.meta;
create policy "equipe le" on public.meta for select to authenticated using ((select public.autorizado()));
insert into public.meta values ('versao_dados', to_char(now(), 'YYYYMMDDHH24MISS'))
  on conflict (chave) do update set valor = excluded.valor;

-- Votos + totais do cargo numa única chamada (antes eram duas).
create or replace function public.dados_painel(p_ids integer[], p_cargo smallint, p_cd_municipio char(5) default null)
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'votos', public.votos_candidaturas(p_ids, p_cd_municipio),
    'totais', public.totais_cargo(p_cargo, p_cd_municipio));
$$;

-- Painel por regra: candidaturas mais votadas + votos + totais numa única chamada (antes eram três, em sequência).
create or replace function public.dados_regra(p_partido text, p_cargo smallint, p_cd_municipio char(5) default null,
                                              p_limite integer default 10)
returns json language plpgsql stable security invoker set search_path = public as $$
declare
  ids integer[];
  top json;
begin
  select coalesce(array_agg(t.candidatura_id order by t.votos desc, t.numero), '{}'),
         coalesce(json_agg(t order by t.votos desc, t.numero), '[]')
    into ids, top
  from public.top_candidaturas(p_partido, p_cargo, p_cd_municipio, p_limite) t;
  return json_build_object('top', top, 'votos', public.votos_candidaturas(ids, p_cd_municipio),
                           'totais', public.totais_cargo(p_cargo, p_cd_municipio));
end $$;

revoke execute on function public.dados_painel(integer[], smallint, char), public.dados_regra(text, smallint, char, integer)
  from public, anon;
grant execute on function public.dados_painel(integer[], smallint, char), public.dados_regra(text, smallint, char, integer)
  to authenticated;
grant select on public.meta to authenticated;
