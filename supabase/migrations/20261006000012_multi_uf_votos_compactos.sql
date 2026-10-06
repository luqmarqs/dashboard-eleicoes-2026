-- Várias UFs no mesmo banco + votos em formato compacto.
--
-- 1) uf em municípios, locais, candidaturas e painéis. Ids continuam globais: cada UF usa uma faixa
--    própria (SP: locais 1.., candidaturas 1..; MG: locais 1.000.001.., candidaturas 100.001..).
-- 2) votos_local (uma linha por local × candidatura, 4,6 mi linhas só em SP) vira votos_cand: uma linha
--    por candidatura com os vetores de locais e votos. É o formato que o dashboard já consome, ocupa
--    uma fração do espaço e mantém o banco no plano gratuito com várias UFs.

alter table public.municipios add column if not exists uf char(2) not null default 'SP';
alter table public.locais add column if not exists uf char(2) not null default 'SP';
alter table public.candidaturas add column if not exists uf char(2) not null default 'SP';
alter table public.paineis add column if not exists uf char(2) not null default 'SP';
create index if not exists locais_uf on public.locais (uf);
create index if not exists candidaturas_uf on public.candidaturas (uf, cd_cargo);

alter table public.candidaturas drop constraint if exists candidaturas_cd_cargo_tipo_numero_key;
alter table public.candidaturas add constraint candidaturas_uf_cargo_tipo_numero_key unique (uf, cd_cargo, tipo, numero);

create table if not exists public.votos_cand (
  candidatura_id integer primary key references public.candidaturas on delete cascade,
  locais         integer[] not null,
  votos          integer[] not null,
  check (cardinality(locais) = cardinality(votos))
);
alter table public.votos_cand enable row level security;
drop policy if exists "equipe le" on public.votos_cand;
create policy "equipe le" on public.votos_cand for select to authenticated using ((select public.autorizado()));

insert into public.votos_cand (candidatura_id, locais, votos)
select candidatura_id, array_agg(local_id order by local_id), array_agg(votos order by local_id)
from public.votos_local group by candidatura_id
on conflict (candidatura_id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Funções com p_uf (padrão 'SP' mantém compatível a versão publicada do dashboard)
-- ---------------------------------------------------------------------------------------------
drop function if exists public.locais_json();
create or replace function public.locais_json(p_uf text default 'SP')
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'id', json_agg(id order by id), 'mun', json_agg(cd_municipio order by id),
    'zona', json_agg(nr_zona order by id), 'nr', json_agg(nr_local order by id),
    'nome', json_agg(nome order by id), 'end', json_agg(endereco order by id),
    'bairro', json_agg(bairro order by id), 'lat', json_agg(lat order by id),
    'lon', json_agg(lon order by id), 'aprox', json_agg(coord_aproximada order by id),
    'secoes', json_agg(qt_secoes order by id))
  from locais where uf = upper(p_uf);
$$;

drop function if exists public.candidaturas_json();
create or replace function public.candidaturas_json(p_uf text default 'SP')
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'id', json_agg(id order by id), 'cargo', json_agg(cd_cargo order by id),
    'tipo', json_agg(tipo order by id), 'numero', json_agg(numero order by id),
    'nome', json_agg(nm_urna order by id), 'nomeCompleto', json_agg(nm_candidato order by id),
    'partido', json_agg(sg_partido order by id), 'destinacao', json_agg(destinacao order by id),
    'votos', json_agg(votos_total order by id), 'situacao', json_agg(situacao order by id))
  from candidaturas where uf = upper(p_uf);
$$;

create or replace function public.votos_candidaturas(p_ids integer[], p_cd_municipio char(5) default null)
returns json language sql stable security invoker set search_path = public as $$
  select coalesce(json_object_agg(s.candidatura_id, s.dados), '{}'::json)
  from (
    select v.candidatura_id,
           case when p_cd_municipio is null
             then json_build_object('local', to_json(v.locais), 'votos', to_json(v.votos))
             else (select json_build_object('local', coalesce(json_agg(u.l order by u.l), '[]'),
                                            'votos', coalesce(json_agg(u.q order by u.l), '[]'))
                   from unnest(v.locais, v.votos) as u(l, q)
                   join locais lo on lo.id = u.l
                   where lo.cd_municipio = p_cd_municipio)
           end as dados
    from votos_cand v
    where v.candidatura_id = any (p_ids)
  ) s;
$$;

drop function if exists public.totais_cargo(smallint, char);
create or replace function public.totais_cargo(p_cargo smallint, p_cd_municipio char(5) default null, p_uf text default 'SP')
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'local', coalesce(json_agg(t.local_id order by t.local_id), '[]'),
    'validos', coalesce(json_agg(t.validos order by t.local_id), '[]'),
    'comparecimento', coalesce(json_agg(t.comparecimento order by t.local_id), '[]'),
    'aptos', coalesce(json_agg(t.aptos order by t.local_id), '[]'))
  from totais_local t
  join locais l on l.id = t.local_id
  where t.cd_cargo = p_cargo and l.uf = upper(p_uf)
    and (p_cd_municipio is null or l.cd_municipio = p_cd_municipio);
$$;

drop function if exists public.top_candidaturas(text, smallint, char, integer);
create or replace function public.top_candidaturas(p_partido text, p_cargo smallint, p_cd_municipio char(5) default null,
                                                   p_limite integer default 10, p_uf text default 'SP')
returns table (candidatura_id integer, numero integer, nm_urna text, votos bigint)
language sql stable security invoker set search_path = public as $$
  select c.id, c.numero, c.nm_urna, c.votos_total
  from candidaturas c
  where p_cd_municipio is null and c.uf = upper(p_uf) and c.sg_partido = p_partido and c.cd_cargo = p_cargo
    and c.tipo = 'nominal' and c.votos_total > 0
  union all
  select c.id, c.numero, c.nm_urna, sum(u.q)::bigint
  from candidaturas c
  join votos_cand v on v.candidatura_id = c.id
  cross join lateral unnest(v.locais, v.votos) as u(l, q)
  join locais lo on lo.id = u.l
  where p_cd_municipio is not null and lo.cd_municipio = p_cd_municipio and c.uf = upper(p_uf)
    and c.sg_partido = p_partido and c.cd_cargo = p_cargo and c.tipo = 'nominal'
  group by c.id, c.numero, c.nm_urna
  order by 4 desc, 2
  limit least(p_limite, 50);
$$;

drop function if exists public.dados_painel(integer[], smallint, char);
drop function if exists public.dados_regra(text, smallint, char, integer);
create or replace function public.dados_regra(p_partido text, p_cargo smallint, p_cd_municipio char(5) default null,
                                              p_limite integer default 10, p_uf text default 'SP')
returns json language plpgsql stable security invoker set search_path = public as $$
declare
  ids integer[];
  top json;
begin
  select coalesce(array_agg(t.candidatura_id order by t.votos desc, t.numero), '{}'),
         coalesce(json_agg(t order by t.votos desc, t.numero), '[]')
    into ids, top
  from public.top_candidaturas(p_partido, p_cargo, p_cd_municipio, p_limite, p_uf) t;
  return json_build_object('top', top, 'votos', public.votos_candidaturas(ids, p_cd_municipio),
                           'totais', public.totais_cargo(p_cargo, p_cd_municipio, p_uf));
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.locais_json(text), public.candidaturas_json(text),
  public.votos_candidaturas(integer[], char), public.totais_cargo(smallint, char, text),
  public.top_candidaturas(text, smallint, char, integer, text), public.dados_regra(text, smallint, char, integer, text),
  public.autorizado(), public.sou_admin(), public.email_atual(), public.listar_autorizados(),
  public.adicionar_autorizado(text, boolean), public.remover_autorizado(text) to authenticated;

-- votos_local deixa de ser usada (os dados estão em votos_cand).
drop table if exists public.votos_local;
