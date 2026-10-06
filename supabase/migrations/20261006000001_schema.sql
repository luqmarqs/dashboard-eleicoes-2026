-- Dashboard eleições 2026: dados agregados por local de votação (fonte: BUs do TSE).
-- Todas as tabelas de dados são somente leitura para usuários autenticados (equipe).

create table if not exists public.municipios (
  cd_municipio  char(5) primary key,          -- código TSE
  cd_ibge       integer not null unique,
  nome          text not null,
  lat           double precision not null,
  lon           double precision not null
);

create table if not exists public.locais (
  id               integer primary key,
  cd_municipio     char(5) not null references public.municipios,
  cd_ibge          integer not null,
  nr_zona          integer not null,
  nr_local         integer not null,
  nome             text not null,
  endereco         text,
  bairro           text not null,
  cep              text,
  lat              double precision not null,
  lon              double precision not null,
  coord_aproximada boolean not null default false,  -- sem coordenada no cadastro do TSE
  qt_secoes        integer not null,
  unique (cd_municipio, nr_zona, nr_local)
);
create index if not exists locais_municipio on public.locais (cd_municipio);

create table if not exists public.candidaturas (
  id            integer primary key,
  cd_eleicao    integer not null,
  cd_cargo      smallint not null,
  ds_cargo      text not null,
  tipo          text not null check (tipo in ('nominal', 'legenda')),
  numero        integer not null,
  nm_urna       text,
  nm_candidato  text,
  nr_partido    smallint,
  sg_partido    text,
  sq_candidato  bigint,
  destinacao    text,                         -- destinação oficial do voto (Válido, Anulado sub judice...)
  votos_total   bigint not null,
  unique (cd_cargo, tipo, numero)
);
create index if not exists candidaturas_partido on public.candidaturas (sg_partido, cd_cargo);
create index if not exists candidaturas_busca on public.candidaturas
  using gin (to_tsvector('simple', coalesce(nm_urna, '') || ' ' || coalesce(nm_candidato, '') || ' ' || numero));

create table if not exists public.votos_local (
  candidatura_id integer not null references public.candidaturas,
  local_id       integer not null references public.locais,
  votos          integer not null,
  primary key (candidatura_id, local_id)
);
create index if not exists votos_local_local on public.votos_local (local_id);

create table if not exists public.totais_local (
  local_id        integer not null references public.locais,
  cd_cargo        smallint not null,
  aptos           integer not null,
  comparecimento  integer not null,
  validos         integer not null,
  brancos         integer not null,
  nulos           integer not null,
  primary key (cd_cargo, local_id)
);

-- Configuração do dashboard
create table if not exists public.partidos_destaque (
  sg_partido text primary key,
  ordem      smallint not null,
  cor        text not null
);
insert into public.partidos_destaque (sg_partido, ordem, cor) values ('PSOL', 1, '#7b1fa2')
  on conflict (sg_partido) do nothing;

create table if not exists public.candidaturas_destaque (
  candidatura_id integer primary key references public.candidaturas,
  ordem          smallint not null
);

-- Painéis personalizados: qualquer membro da equipe cria; todos veem; só o autor edita.
create table if not exists public.paineis (
  id              uuid primary key default gen_random_uuid(),
  autor           uuid not null default auth.uid() references auth.users on delete cascade,
  titulo          text not null,
  candidatura_ids integer[] not null check (cardinality(candidatura_ids) between 1 and 12),
  cd_municipio    char(5) references public.municipios,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Acesso: somente usuários autenticados. Desative o cadastro aberto no painel do Supabase
-- (Authentication > Sign In / Providers > "Allow new users to sign up" desligado) e convide a equipe.
-- ---------------------------------------------------------------------------------------------
alter table public.municipios enable row level security;
alter table public.locais enable row level security;
alter table public.candidaturas enable row level security;
alter table public.votos_local enable row level security;
alter table public.totais_local enable row level security;
alter table public.partidos_destaque enable row level security;
alter table public.candidaturas_destaque enable row level security;
alter table public.paineis enable row level security;

do $$
declare t text;
begin
  foreach t in array array['municipios', 'locais', 'candidaturas', 'votos_local', 'totais_local',
                           'partidos_destaque', 'candidaturas_destaque', 'paineis']
  loop
    execute format('drop policy if exists "equipe le" on public.%I', t);
    execute format('create policy "equipe le" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

drop policy if exists "autor cria" on public.paineis;
create policy "autor cria" on public.paineis for insert to authenticated with check (autor = auth.uid());
drop policy if exists "autor edita" on public.paineis;
create policy "autor edita" on public.paineis for update to authenticated
  using (autor = auth.uid()) with check (autor = auth.uid());
drop policy if exists "autor apaga" on public.paineis;
create policy "autor apaga" on public.paineis for delete to authenticated using (autor = auth.uid());

revoke all on all tables in schema public from anon;
