-- Papel 'paga' em meta_dobradas_json: anúncios cujo financiador é o CNPJ de campanha da candidatura e que citam OUTRAS
-- candidaturas (com número), vindos de páginas que não são dela. É o único rastro de tráfego pago de candidaturas cujas
-- páginas não foram coletadas (só eleitas + Manuela foram): ex. Orlando Silva (suplente) pagou anúncios citando a Bancada
-- Feminista. O painel usa 'paga' para dizer "pagou pelo menos N anúncios" em vez de ficar em silêncio.
-- meta_dobradas_cache cai nesta função quando não há linha em cache, então candidaturas não coletadas são calculadas ao vivo.

create or replace function public.meta_dobradas_json(p_candidatura_id integer)
returns json language sql stable security invoker set search_path = public as $$
  with proprias as (
    select page_id from meta_vinculos where candidatura_id = p_candidatura_id and status_revisao <> 'rejeitado'
  ), m as (
    select 'recebe' as papel, mm.*, mm.pagador_candidatura_id as outra
    from meta_mencoes mm
    where mm.candidatura_id = p_candidatura_id and mm.pagador_candidatura_id is distinct from p_candidatura_id
      and mm.ad_id not in (select ad_id from meta_anuncios where page_id in (select page_id from proprias))
    union all
    select 'faz', mm.*, mm.candidatura_id
    from meta_mencoes mm join meta_anuncios a using (ad_id)
    where a.page_id in (select page_id from proprias) and mm.candidatura_id <> p_candidatura_id and mm.cita_numero
    union all
    select 'paga', mm.*, mm.candidatura_id
    from meta_mencoes mm join meta_anuncios a using (ad_id)
    where mm.pagador_candidatura_id = p_candidatura_id and mm.candidatura_id <> p_candidatura_id and mm.cita_numero
      and a.page_id not in (select page_id from proprias)
  )
  select coalesce(json_agg(json_build_object(
    'papel', m.papel, 'outra', m.outra, 'cita_nome', m.cita_nome, 'cita_numero', m.cita_numero,
    'confirmada', m.confirmada, 'cnpjs_texto', m.cnpjs_texto, 'cnpj_financiador', m.cnpj_financiador,
    'ad', meta_anuncio_obj(a)) order by a.inicio_veiculacao desc), '[]')
  from m join meta_anuncios a using (ad_id);
$$;
grant execute on function public.meta_dobradas_json(integer) to authenticated;
