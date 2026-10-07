-- Anúncios políticos da Biblioteca de Anúncios da Meta (API ads_archive), coletados por src/meta_ads.
-- Três coisas diferentes, em tabelas diferentes:
--   meta_localidades        localidades SELECIONADAS pelo anunciante (segmentação; incluída ou excluída)
--   meta_entrega_regional   onde o anúncio foi ENTREGUE: proporção do alcance por região (UF), informada pela Meta
--   (votação)               continua nas tabelas do TSE; o cruzamento é descritivo, feito no painel
-- Métricas da Meta são faixas acumuladas por anúncio (gasto, impressões) e estimativas (alcance, público):
-- *_min/*_max; teto nulo = faixa aberta (não é zero). IDs da Meta são texto (passam de 2^53).

create table if not exists public.meta_vinculos (
  page_id        text not null,
  candidatura_id integer not null references public.candidaturas on delete cascade,
  uf             char(2) not null,
  page_name      text,
  natureza       text not null check (natureza in ('oficial', 'partido', 'apoiador', 'nao_confirmado')),
  evidencia      text,
  status_revisao text not null check (status_revisao in ('confirmado', 'a_revisar', 'rejeitado')),
  coletar        boolean not null default false,
  primary key (page_id, candidatura_id)
);

create table if not exists public.meta_anuncios (
  ad_id                 text primary key,
  page_id               text not null,
  page_name             text,
  bylines               text,          -- financiador declarado
  criado_em             date,          -- a API devolve só a data
  inicio_veiculacao     date,
  fim_veiculacao        date,          -- nulo = ainda em veiculação na última coleta
  textos                jsonb,
  titulos_link          jsonb,
  descricoes_link       jsonb,
  legendas_link         jsonb,
  plataformas           jsonb,
  idiomas               jsonb,
  moeda                 text,
  gasto_min             numeric,
  gasto_max             numeric,       -- nulo = sem teto informado
  impressoes_min        numeric,
  impressoes_max        numeric,
  alcance_br            integer,       -- alcance estimado no Brasil (por anúncio; não somar entre anúncios)
  publico_estimado_min  numeric,
  publico_estimado_max  numeric,
  idades_alvo           jsonb,
  genero_alvo           text,
  link_biblioteca       text,          -- link público, sem token
  primeira_coleta       timestamptz not null,
  ultima_coleta         timestamptz not null,
  ultima_execucao       text
);
create index if not exists meta_anuncios_page on public.meta_anuncios (page_id);

create table if not exists public.meta_observacoes (
  ad_id          text not null references public.meta_anuncios on delete cascade,
  coletado_em    timestamptz not null,
  execucao_id    text not null,
  versao_api     text not null,
  hash           text not null,
  gasto_min      numeric, gasto_max numeric, impressoes_min numeric, impressoes_max numeric, alcance_br integer,
  bruto          jsonb not null,       -- referência à resposta saneada (SQLite local, gzip) + hash; não a resposta inteira
  primary key (ad_id, execucao_id)    -- uma observação por anúncio e execução, só quando o anúncio mudou
);

create table if not exists public.meta_localidades (
  ad_id          text not null references public.meta_anuncios on delete cascade,
  ordem          smallint not null,
  nome_original  text not null,
  tipo           text,                 -- tipo devolvido pela Meta (CITY, MUNICIPALITY, NEIGHBORHOOD, zips, regions…)
  excluida       boolean not null,
  num_obfuscated integer,
  nivel          text not null check (nivel in ('pais', 'uf', 'municipio', 'bairro', 'cep', 'desconhecida')),
  uf             char(2),
  municipio_nome text,
  cd_ibge        integer,              -- só com correspondência validada (nome + UF únicos no cadastro IBGE)
  cd_municipio   char(5),              -- código TSE derivado de cd_ibge pelo cadastro do painel
  bairro_nome    text,                 -- nome da Meta; não é ligado aos bairros do TSE
  cep_prefixo    text,
  status         text not null,        -- validada | ambigua | nao_encontrada | sem_municipio | nao_aplicavel | nao_resolvida
  metodo         text,
  primary key (ad_id, ordem)
);
create index if not exists meta_localidades_mun on public.meta_localidades (cd_municipio);

create table if not exists public.meta_entrega_regional (
  ad_id     text not null references public.meta_anuncios on delete cascade,
  regiao    text not null,
  uf        char(2),
  proporcao numeric,                   -- fração do alcance do anúncio naquela região (0–1)
  primary key (ad_id, regiao)
);

create table if not exists public.meta_execucoes (
  id                 text primary key,
  modo               text not null,
  iniciada_em        timestamptz not null,
  terminada_em       timestamptz,
  status             text not null,    -- completa | parcial | falhou | em_andamento
  versao_api         text not null,
  periodo_min        date,
  periodo_max        date,
  paginas_alvo       integer,
  paginas_concluidas integer,
  paginas_com_falha  integer,
  anuncios_vistos    integer,
  anuncios_novos     integer,
  observacoes_novas  integer,
  erros              jsonb             -- já saneados
);

do $$
declare t text;
begin
  foreach t in array array['meta_vinculos', 'meta_anuncios', 'meta_observacoes', 'meta_localidades',
                           'meta_entrega_regional', 'meta_execucoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "equipe le" on public.%I', t);
    execute format('create policy "equipe le" on public.%I for select to authenticated using ((select public.autorizado()))', t);
  end loop;
end $$;

-- Resumo por candidatura da UF (para o seletor e para a cobertura).
create or replace function public.meta_resumo_json(p_uf char(2))
returns json language sql stable security invoker set search_path = public as $$
  with v as (
    select * from meta_vinculos where uf = p_uf and status_revisao <> 'rejeitado'
  ), a as (
    select v.candidatura_id, count(distinct an.ad_id) as anuncios,
           sum(an.gasto_min) as gasto_min, sum(an.gasto_max) as gasto_max,
           bool_or(an.gasto_max is null and an.ad_id is not null) as gasto_aberto,
           count(distinct an.moeda) as moedas, max(an.ultima_coleta) as ultima_coleta
    from v left join meta_anuncios an on an.page_id = v.page_id
    group by v.candidatura_id
  )
  select json_build_object(
    'execucao', (select row_to_json(e) from meta_execucoes e order by iniciada_em desc limit 1),
    'ultima_completa', (select max(iniciada_em) from meta_execucoes where status = 'completa'),
    'candidaturas', coalesce((
      select json_agg(json_build_object(
        'candidatura_id', c.candidatura_id,
        'paginas', (select json_agg(json_build_object('page_id', page_id, 'page_name', page_name, 'natureza', natureza,
                    'status_revisao', status_revisao, 'evidencia', evidencia, 'coletar', coletar) order by page_name)
                    from v where v.candidatura_id = c.candidatura_id),
        'anuncios', a.anuncios, 'gasto_min', a.gasto_min, 'gasto_max', a.gasto_max, 'gasto_aberto', a.gasto_aberto,
        'moedas', a.moedas, 'ultima_coleta', a.ultima_coleta) order by a.gasto_max desc nulls last)
      from (select distinct candidatura_id from v) c join a using (candidatura_id)), '[]')
  );
$$;

-- Anúncios de uma candidatura, com segmentação e entrega.
create or replace function public.meta_anuncios_json(p_candidatura_id integer)
returns json language sql stable security invoker set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', an.ad_id, 'page_id', an.page_id, 'page_name', an.page_name, 'bylines', an.bylines,
    'criado', an.criado_em, 'inicio', an.inicio_veiculacao, 'fim', an.fim_veiculacao,
    'textos', an.textos, 'titulos', an.titulos_link, 'plataformas', an.plataformas, 'moeda', an.moeda,
    'gasto', json_build_array(an.gasto_min, an.gasto_max), 'impressoes', json_build_array(an.impressoes_min, an.impressoes_max),
    'alcance', an.alcance_br, 'publico', json_build_array(an.publico_estimado_min, an.publico_estimado_max),
    'idades', an.idades_alvo, 'genero', an.genero_alvo, 'link', an.link_biblioteca,
    'primeira_coleta', an.primeira_coleta, 'ultima_coleta', an.ultima_coleta,
    'loc', (select coalesce(json_agg(json_build_array(l.nivel, l.tipo, l.excluida, l.uf, l.municipio_nome, l.cd_ibge,
              l.cd_municipio, l.bairro_nome, l.cep_prefixo, l.status, l.nome_original) order by l.ordem), '[]')
            from meta_localidades l where l.ad_id = an.ad_id),
    'entrega', (select coalesce(json_agg(json_build_array(coalesce(e.uf, e.regiao), e.proporcao) order by e.proporcao desc), '[]')
                from meta_entrega_regional e where e.ad_id = an.ad_id)
  ) order by an.inicio_veiculacao desc, an.ad_id), '[]')
  from meta_anuncios an
  where an.page_id in (select page_id from meta_vinculos where candidatura_id = p_candidatura_id and status_revisao <> 'rejeitado');
$$;

grant execute on function public.meta_resumo_json(char), public.meta_anuncios_json(integer) to authenticated;
