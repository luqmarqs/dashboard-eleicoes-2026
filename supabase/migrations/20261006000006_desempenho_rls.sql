-- Desempenho: autorizado() era avaliada linha a linha nas políticas de RLS (milhões de chamadas em
-- consultas sobre votos_local). Envolta em (select ...), o Postgres a avalia uma vez por consulta.

do $$
declare t text;
begin
  foreach t in array array['municipios', 'locais', 'candidaturas', 'votos_local', 'totais_local',
                           'partidos_destaque', 'candidaturas_destaque', 'paineis']
  loop
    execute format('drop policy if exists "equipe le" on public.%I', t);
    execute format('create policy "equipe le" on public.%I for select to authenticated using ((select public.autorizado()))', t);
  end loop;
end $$;

drop policy if exists "autor cria" on public.paineis;
create policy "autor cria" on public.paineis for insert to authenticated
  with check (autor = (select auth.uid()) and (select public.autorizado()));
drop policy if exists "autor edita" on public.paineis;
create policy "autor edita" on public.paineis for update to authenticated
  using (autor = (select auth.uid()) and (select public.autorizado()))
  with check (autor = (select auth.uid()) and (select public.autorizado()));
drop policy if exists "autor apaga" on public.paineis;
create policy "autor apaga" on public.paineis for delete to authenticated
  using (autor = (select auth.uid()) and (select public.autorizado()));

-- No estado inteiro, o total por candidatura já está em candidaturas.votos_total (sem somar locais).
create or replace function public.top_candidaturas(p_partido text, p_cargo smallint,
                                                   p_cd_municipio char(5) default null, p_limite integer default 10)
returns table (candidatura_id integer, numero integer, nm_urna text, votos bigint)
language sql stable security invoker set search_path = public as $$
  select c.id, c.numero, c.nm_urna, c.votos_total
  from candidaturas c
  where p_cd_municipio is null and c.sg_partido = p_partido and c.cd_cargo = p_cargo and c.tipo = 'nominal'
    and c.votos_total > 0
  union all
  select c.id, c.numero, c.nm_urna, sum(v.votos)::bigint
  from candidaturas c
  join votos_local v on v.candidatura_id = c.id
  join locais l on l.id = v.local_id
  where p_cd_municipio is not null and l.cd_municipio = p_cd_municipio
    and c.sg_partido = p_partido and c.cd_cargo = p_cargo and c.tipo = 'nominal'
  group by c.id, c.numero, c.nm_urna
  order by 4 desc, 2
  limit least(p_limite, 50);
$$;
