-- Comparativo das prioritárias em cache (a consulta leva ~12 s): linha 'BR' de meta_cache_uf, recalculada após cada carga.
create or replace function public.meta_atualizar_prioritarias()
returns void language sql security definer set search_path = public as $$
  insert into meta_cache_uf values ('BR', meta_prioritarias_json(), now())
    on conflict (uf) do update set payload = excluded.payload, gerado_em = excluded.gerado_em;
$$;
revoke execute on function public.meta_atualizar_prioritarias() from public, anon, authenticated;

create or replace function public.meta_prioritarias_cache()
returns json language sql stable security invoker set search_path = public as $$
  select coalesce((select payload from meta_cache_uf where uf = 'BR'), '[]'::json);
$$;
grant execute on function public.meta_prioritarias_cache() to authenticated;
