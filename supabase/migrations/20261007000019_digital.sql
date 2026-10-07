-- Evolução digital (perfis em redes sociais) das candidaturas acompanhadas, para comparar com a votação.
-- Observações nunca são sobrescritas: cada medição (data + fonte) é uma linha. Ausência fica nula (não é zero).

create table if not exists public.digital_perfis (
  perfil_key      text primary key,          -- "<plataforma>:<id estável ou username>"
  plataforma      text not null,             -- instagram | facebook | tiktok | x | youtube …
  perfil_id       text,                      -- ID estável da plataforma, quando conhecido
  username        text,
  url             text,
  nome_publico    text,
  candidatura_id  integer references public.candidaturas on delete set null,
  uf              char(2) not null,
  status_vinculo  text not null check (status_vinculo in ('confirmado', 'pendente', 'rejeitado')),
  evidencia       text
);

create table if not exists public.digital_observacoes (
  perfil_key      text not null references public.digital_perfis on delete cascade,
  observado_em    timestamptz,               -- instante da medição; nulo = data desconhecida (não entra em taxas)
  data_observacao date,                      -- dia da medição (fuso America/Sao_Paulo), quando conhecido
  origem_data     text not null,             -- campo:<nome> | pasta | relatorio | coleta | desconhecida
  importado_em    timestamptz not null default now(),
  seguidores      bigint,
  seguindo        bigint,
  posts           bigint,
  precisao        text not null check (precisao in ('exata', 'arredondada', 'estimada')),
  fonte           text not null,             -- historico:<tipo> | apify:<actor>
  fonte_arquivo   text,                      -- caminho relativo do arquivo histórico (proveniência)
  status_coleta   text not null default 'ok', -- ok | privado | indisponivel | removido | username_alterado | falha
  execucao_id     text,
  chave           text not null,             -- dedup: perfil + data/instante + fonte + valor
  primary key (chave)
);
create index if not exists digital_obs_perfil on public.digital_observacoes (perfil_key, data_observacao);

-- Postagens (orgânico): métricas medidas no instante da coleta (a idade da postagem varia; não é série temporal).
create table if not exists public.digital_posts (
  post_id        text not null,
  perfil_key     text not null references public.digital_perfis on delete cascade,
  coautoria      boolean not null default false,  -- postagem de outra conta com a candidatura como coautora (collab)
  publicado_em   timestamptz,
  tipo           text,                       -- Image | Video | Sidecar …
  url            text,
  curtidas       bigint,                     -- nulo = oculto/indisponível (não é zero)
  comentarios    bigint,
  visualizacoes  bigint,                     -- só vídeos
  fixado         boolean,
  coletado_em    timestamptz not null,
  execucao_id    text not null,
  primary key (post_id, perfil_key, execucao_id)
);
create index if not exists digital_posts_perfil on public.digital_posts (perfil_key, publicado_em);

create table if not exists public.digital_execucoes (
  id                 text primary key,
  iniciada_em        timestamptz not null,
  terminada_em       timestamptz,
  tipo               text not null,          -- importacao_historica | snapshot_apify
  perfis_solicitados integer,
  perfis_obtidos     integer,
  falhas             jsonb,
  custo_usd          numeric,
  custo_confirmado   boolean,                -- true = informado pela plataforma; false = estimativa
  teto_usd           numeric,
  proveniencia       text
);

do $$
declare t text;
begin
  foreach t in array array['digital_perfis', 'digital_observacoes', 'digital_posts', 'digital_execucoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "equipe le" on public.%I', t);
    execute format('create policy "equipe le" on public.%I for select to authenticated using ((select public.autorizado()))', t);
  end loop;
end $$;

create or replace function public.digital_json(p_uf char(2))
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'perfis', coalesce((select json_agg(p order by p.plataforma, p.username) from digital_perfis p
                        where p.uf = p_uf and p.status_vinculo <> 'rejeitado'), '[]'),
    'observacoes', coalesce((select json_agg(json_build_object(
        'perfil_key', o.perfil_key, 'observado_em', o.observado_em, 'data', o.data_observacao, 'origem_data', o.origem_data,
        'seguidores', o.seguidores, 'seguindo', o.seguindo, 'posts', o.posts, 'precisao', o.precisao, 'fonte', o.fonte,
        'fonte_arquivo', o.fonte_arquivo, 'status', o.status_coleta) order by o.perfil_key, o.data_observacao nulls first)
      from digital_observacoes o join digital_perfis p using (perfil_key) where p.uf = p_uf and p.status_vinculo <> 'rejeitado'), '[]'),
    'posts', (select json_build_object(
        'perfil_key', coalesce(json_agg(x.perfil_key order by x.perfil_key, x.publicado_em), '[]'),
        'publicado', coalesce(json_agg(x.publicado_em order by x.perfil_key, x.publicado_em), '[]'),
        'tipo', coalesce(json_agg(x.tipo order by x.perfil_key, x.publicado_em), '[]'),
        'curtidas', coalesce(json_agg(x.curtidas order by x.perfil_key, x.publicado_em), '[]'),
        'comentarios', coalesce(json_agg(x.comentarios order by x.perfil_key, x.publicado_em), '[]'),
        'views', coalesce(json_agg(x.visualizacoes order by x.perfil_key, x.publicado_em), '[]'),
        'url', coalesce(json_agg(x.url order by x.perfil_key, x.publicado_em), '[]'),
        'fixado', coalesce(json_agg(x.fixado order by x.perfil_key, x.publicado_em), '[]'),
        'coletado', coalesce(json_agg(x.coletado_em order by x.perfil_key, x.publicado_em), '[]')
        ,'coautoria', coalesce(json_agg(x.coautoria order by x.perfil_key, x.publicado_em), '[]'))
      from (select distinct on (d.post_id, d.perfil_key) d.* from digital_posts d join digital_perfis p using (perfil_key)
            where p.uf = p_uf order by d.post_id, d.perfil_key, d.coletado_em desc) x),
    'execucoes', coalesce((select json_agg(e order by e.iniciada_em desc) from digital_execucoes e), '[]')
  );
$$;
grant execute on function public.digital_json(char) to authenticated;
