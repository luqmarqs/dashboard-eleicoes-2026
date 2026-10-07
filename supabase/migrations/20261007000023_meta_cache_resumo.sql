-- Resumo do painel Publicidade também em cache (por UF); a primeira leitura a frio levava 1–3 s.
create table if not exists public.meta_cache_uf (
  uf        char(2) primary key,
  payload   json not null,
  gerado_em timestamptz not null default now()
);
alter table public.meta_cache_uf enable row level security;
drop policy if exists "equipe le" on public.meta_cache_uf;
create policy "equipe le" on public.meta_cache_uf for select to authenticated using ((select public.autorizado()));

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
  insert into meta_cache_uf values (p_uf, meta_resumo_json(p_uf), now())
    on conflict (uf) do update set payload = excluded.payload, gerado_em = excluded.gerado_em;
  return n;
end $$;
revoke execute on function public.meta_atualizar_cache(char) from public, anon, authenticated;

create or replace function public.meta_resumo_cache(p_uf char(2))
returns json language sql stable security invoker set search_path = public as $$
  select coalesce((select payload from meta_cache_uf where uf = p_uf), meta_resumo_json(p_uf));
$$;
grant execute on function public.meta_resumo_cache(char) to authenticated;
