-- Situação oficial da candidatura (TSE): Eleito, Eleito por QP, Eleito por média, 2º turno, Suplente, Não eleito.
alter table public.candidaturas add column if not exists situacao text;

create or replace function public.candidaturas_json()
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'id', json_agg(id order by id), 'cargo', json_agg(cd_cargo order by id),
    'tipo', json_agg(tipo order by id), 'numero', json_agg(numero order by id),
    'nome', json_agg(nm_urna order by id), 'nomeCompleto', json_agg(nm_candidato order by id),
    'partido', json_agg(sg_partido order by id), 'destinacao', json_agg(destinacao order by id),
    'votos', json_agg(votos_total order by id), 'situacao', json_agg(situacao order by id))
  from candidaturas;
$$;

-- Painéis padrão (sem autor): visíveis a todos; só administradores podem apagá-los.
alter table public.paineis alter column autor drop not null;
drop policy if exists "autor apaga" on public.paineis;
create policy "autor apaga" on public.paineis for delete to authenticated
  using ((autor = (select auth.uid()) or (select public.sou_admin())) and (select public.autorizado()));
