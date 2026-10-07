-- Disk IO: o cache do painel era recalculado inteiro (todas as candidaturas da UF) a cada carga, com ordenações grandes
-- derramando para arquivos temporários (1,9 GB de temp e 1,2 GB lidos em 18 execuções num dia). Duas medidas:
--   1) meta_atualizar_cache só refaz candidaturas "velhas": sem cache, ou com anúncio/menção/vínculo mais novo que o cache
--      (p_tudo = true força tudo, para mudanças de formato);
--   2) work_mem local nas funções que montam JSON grande ou agregam milhões de linhas, para ordenar em memória.

create or replace function public.meta_atualizar_cache(p_uf char(2), p_tudo boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; c integer;
begin
  for c in
    select distinct v.candidatura_id
    from meta_vinculos v
    where v.uf = p_uf and v.status_revisao <> 'rejeitado'
      and (p_tudo
           or not exists (select 1 from meta_cache k where k.candidatura_id = v.candidatura_id and k.tipo = 'anuncios')
           or not exists (select 1 from meta_cache k where k.candidatura_id = v.candidatura_id and k.tipo = 'dobradas')
           -- anúncio novo/atualizado nas páginas dela desde o cache
           or exists (select 1 from meta_anuncios a join meta_vinculos v2 on v2.page_id = a.page_id
                      where v2.candidatura_id = v.candidatura_id and v2.status_revisao <> 'rejeitado'
                        and a.ultima_coleta > (select min(k.gerado_em) from meta_cache k where k.candidatura_id = v.candidatura_id))
           -- menção nova que a envolve (citada ou pagadora) desde o cache
           or exists (select 1 from meta_mencoes m join meta_anuncios a using (ad_id)
                      where (m.candidatura_id = v.candidatura_id or m.pagador_candidatura_id = v.candidatura_id)
                        and a.ultima_coleta > (select min(k.gerado_em) from meta_cache k where k.candidatura_id = v.candidatura_id)))
  loop
    insert into meta_cache values (c, 'anuncios', meta_anuncios_compacto(c), now())
      on conflict (candidatura_id, tipo) do update set payload = excluded.payload, gerado_em = excluded.gerado_em;
    insert into meta_cache values (c, 'dobradas', meta_dobradas_json(c), now())
      on conflict (candidatura_id, tipo) do update set payload = excluded.payload, gerado_em = excluded.gerado_em;
    n := n + 1;
  end loop;
  -- o resumo da UF é barato em relação ao resto e muda com qualquer carga: refaz sempre
  insert into meta_cache_uf values (p_uf, meta_resumo_json(p_uf), now())
    on conflict (uf) do update set payload = excluded.payload, gerado_em = excluded.gerado_em;
  return n;
end $$;
revoke execute on function public.meta_atualizar_cache(char, boolean) from public, anon, authenticated;

-- ordenar em memória em vez de derramar para disco (só nestas funções; o padrão da instância fica como está)
alter function public.meta_atualizar_cache(char, boolean) set work_mem = '128MB';
alter function public.meta_anuncios_compacto(integer) set work_mem = '128MB';
alter function public.meta_dobradas_json(integer) set work_mem = '64MB';
alter function public.meta_resumo_json(char) set work_mem = '64MB';
alter function public.meta_prioritarias_json() set work_mem = '64MB';
alter function public.apocalipse_atualizar(char) set work_mem = '256MB';
