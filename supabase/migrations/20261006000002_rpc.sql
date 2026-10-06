-- Funções de leitura do dashboard. Devolvem JSON colunar ({"campo": [..], ...}) para trafegar
-- poucos bytes e contornar o limite de linhas por requisição da API. SECURITY INVOKER: valem as
-- políticas de RLS (só usuários autenticados).

create or replace function public.locais_json()
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'id', json_agg(id order by id), 'mun', json_agg(cd_municipio order by id),
    'zona', json_agg(nr_zona order by id), 'nr', json_agg(nr_local order by id),
    'nome', json_agg(nome order by id), 'end', json_agg(endereco order by id),
    'bairro', json_agg(bairro order by id), 'lat', json_agg(lat order by id),
    'lon', json_agg(lon order by id), 'aprox', json_agg(coord_aproximada order by id),
    'secoes', json_agg(qt_secoes order by id))
  from locais;
$$;

create or replace function public.candidaturas_json()
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'id', json_agg(id order by id), 'cargo', json_agg(cd_cargo order by id),
    'tipo', json_agg(tipo order by id), 'numero', json_agg(numero order by id),
    'nome', json_agg(nm_urna order by id), 'nomeCompleto', json_agg(nm_candidato order by id),
    'partido', json_agg(sg_partido order by id), 'destinacao', json_agg(destinacao order by id),
    'votos', json_agg(votos_total order by id))
  from candidaturas;
$$;

-- Votos de várias candidaturas por local (opcionalmente só num município).
create or replace function public.votos_candidaturas(p_ids integer[], p_cd_municipio char(5) default null)
returns json language sql stable security invoker set search_path = public as $$
  select coalesce(json_object_agg(candidatura_id, dados), '{}'::json)
  from (
    select v.candidatura_id,
           json_build_object('local', json_agg(v.local_id order by v.local_id),
                             'votos', json_agg(v.votos order by v.local_id)) as dados
    from votos_local v
    join locais l on l.id = v.local_id
    where v.candidatura_id = any (p_ids)
      and (p_cd_municipio is null or l.cd_municipio = p_cd_municipio)
    group by v.candidatura_id
  ) s;
$$;

-- Totais do cargo por local (denominador das porcentagens).
create or replace function public.totais_cargo(p_cargo smallint, p_cd_municipio char(5) default null)
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'local', coalesce(json_agg(t.local_id order by t.local_id), '[]'),
    'validos', coalesce(json_agg(t.validos order by t.local_id), '[]'),
    'comparecimento', coalesce(json_agg(t.comparecimento order by t.local_id), '[]'),
    'aptos', coalesce(json_agg(t.aptos order by t.local_id), '[]'))
  from totais_local t
  join locais l on l.id = t.local_id
  where t.cd_cargo = p_cargo and (p_cd_municipio is null or l.cd_municipio = p_cd_municipio);
$$;

-- Candidaturas mais votadas de um partido (e cargo) no estado ou num município.
create or replace function public.top_candidaturas(p_partido text, p_cargo smallint,
                                                   p_cd_municipio char(5) default null, p_limite integer default 10)
returns table (candidatura_id integer, numero integer, nm_urna text, votos bigint)
language sql stable security invoker set search_path = public as $$
  select c.id, c.numero, c.nm_urna, sum(v.votos)::bigint
  from candidaturas c
  join votos_local v on v.candidatura_id = c.id
  join locais l on l.id = v.local_id
  where c.sg_partido = p_partido and c.cd_cargo = p_cargo and c.tipo = 'nominal'
    and (p_cd_municipio is null or l.cd_municipio = p_cd_municipio)
  group by c.id, c.numero, c.nm_urna
  order by 4 desc, 2
  limit least(p_limite, 50);
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.locais_json(), public.candidaturas_json(),
  public.votos_candidaturas(integer[], char), public.totais_cargo(smallint, char),
  public.top_candidaturas(text, smallint, char, integer) to authenticated;
