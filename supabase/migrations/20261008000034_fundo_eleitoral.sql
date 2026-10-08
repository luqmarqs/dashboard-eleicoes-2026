-- Fundo eleitoral (FEFC) recebido por candidatura, da prestação de contas do TSE (receitas_candidatos_2026), carregado por
-- scripts/fundo_eleitoral.py. Receitas são declaradas em até 72 h, então o fundo já é número quase fechado; o gasto
-- (despesas contratadas) vai junto só como referência, porque até a prestação final ainda é parcial.

create table if not exists public.fundo_cand (
  uf               char(2) not null,
  cd_cargo         smallint not null,
  numero           integer not null,
  fundo_eleitoral  numeric(14, 2) not null,   -- FEFC recebido (financeiro + estimável; do partido ou de outras candidaturas)
  fundo_partidario numeric(14, 2) not null,
  receita_total    numeric(14, 2) not null,
  gasto_declarado  numeric(14, 2),            -- despesas contratadas; nulo = sem prestação no arquivo
  prestacao        text,                      -- Relatório Financeiro, Parcial ou Final
  data_prestacao   date,
  data_tse         date not null,             -- data de geração do arquivo do TSE
  primary key (uf, cd_cargo, numero)
);
alter table public.fundo_cand enable row level security;
drop policy if exists "equipe le" on public.fundo_cand;
create policy "equipe le" on public.fundo_cand for select to authenticated using ((select public.autorizado()));

create or replace function public.fundo_json(p_uf char(2))
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'id', coalesce(json_agg(c.id order by c.id), '[]'),
    'fundo', coalesce(json_agg(f.fundo_eleitoral order by c.id), '[]'),
    'partidario', coalesce(json_agg(f.fundo_partidario order by c.id), '[]'),
    'receita', coalesce(json_agg(f.receita_total order by c.id), '[]'),
    'gasto', coalesce(json_agg(f.gasto_declarado order by c.id), '[]'),
    'prestacao', coalesce(json_agg(f.prestacao order by c.id), '[]'),
    'data_prestacao', coalesce(json_agg(f.data_prestacao order by c.id), '[]'),
    'data_tse', max(f.data_tse))
  from fundo_cand f
  join candidaturas c on c.uf = f.uf and c.cd_cargo = f.cd_cargo and c.numero = f.numero and c.tipo = 'nominal'
  where f.uf = p_uf;
$$;
grant execute on function public.fundo_json(char) to authenticated;
