-- Cache das respostas do painel Publicidade: pré-calculadas a cada carga, lidas em milissegundos.
-- tipo 'anuncios' = meta_anuncios_compacto; 'dobradas' = meta_dobradas_json. Sem linha no cache, calcula na hora.

create table if not exists public.meta_cache (
  candidatura_id integer not null references public.candidaturas on delete cascade,
  tipo           text not null check (tipo in ('anuncios', 'dobradas')),
  payload        json not null,
  gerado_em      timestamptz not null default now(),
  primary key (candidatura_id, tipo)
);
alter table public.meta_cache enable row level security;
drop policy if exists "equipe le" on public.meta_cache;
create policy "equipe le" on public.meta_cache for select to authenticated using ((select public.autorizado()));

-- Recalcula o cache das candidaturas de uma UF (rodar como dono do banco, depois de cada carga).
create or replace function public.meta_atualizar_cache(p_uf char(2))
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; c integer;
begin
  for c in select distinct candidatura_id from meta_vinculos where uf = p_uf and status_revisao <> 'rejeitado' loop
    insert into meta_cache values (c, 'anuncios', meta_anuncios_compacto(c), now())
      on conflict (candidatura_id, tipo) do update set payload = excluded.payload, gerado_em = excluded.gerado_em;
    insert into meta_cache values (c, 'dobradas', meta_dobradas_json(c), now())
      on conflict (candidatura_id, tipo) do update set payload = excluded.payload, gerado_em = excluded.gerado_em;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.meta_atualizar_cache(char) from public, anon, authenticated;

create or replace function public.meta_anuncios_cache(p_candidatura_id integer)
returns json language sql stable security invoker set search_path = public as $$
  select coalesce((select payload from meta_cache where candidatura_id = p_candidatura_id and tipo = 'anuncios'),
                  meta_anuncios_compacto(p_candidatura_id));
$$;

create or replace function public.meta_dobradas_cache(p_candidatura_id integer)
returns json language sql stable security invoker set search_path = public as $$
  select coalesce((select payload from meta_cache where candidatura_id = p_candidatura_id and tipo = 'dobradas'),
                  meta_dobradas_json(p_candidatura_id));
$$;
grant execute on function public.meta_anuncios_cache(integer), public.meta_dobradas_cache(integer) to authenticated;
