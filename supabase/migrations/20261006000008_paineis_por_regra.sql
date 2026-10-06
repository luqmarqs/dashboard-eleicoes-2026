-- Painéis por regra: em vez de uma lista fixa, "as N mais votadas do partido X nos cargos Y",
-- recalculadas para o município escolhido (o mesmo formato das planilhas por cidade/bairro/escola).
alter table public.paineis add column if not exists regra jsonb;
alter table public.paineis drop constraint if exists paineis_candidatura_ids_check;
alter table public.paineis add constraint paineis_conteudo_check check (
  (regra is not null and cardinality(candidatura_ids) = 0)
  or (regra is null and cardinality(candidatura_ids) between 1 and 12)
);
alter table public.paineis add constraint paineis_regra_check check (
  regra is null or (regra ? 'partido' and regra ? 'cargos' and regra ? 'top')
);

-- Painéis padrão (os recortes das planilhas já entregues).
insert into public.paineis (titulo, candidatura_ids, regra, cd_municipio, autor)
select v.titulo, v.ids, v.regra, v.mun, null
from (values
  ('PSOL · 10 mais votados (federal e estadual)', '{}'::int[],
   '{"partido": "PSOL", "cargos": [6, 7], "top": 10}'::jsonb, null::char(5)),
  ('PSOL em Campinas · 10 mais votados', '{}'::int[],
   '{"partido": "PSOL", "cargos": [6, 7], "top": 10}'::jsonb, '62910'),
  ('PSOL em São Paulo (capital) · 10 mais votados', '{}'::int[],
   '{"partido": "PSOL", "cargos": [6, 7], "top": 10}'::jsonb, '71072'),
  ('Paula da Bancada Feminista (50000)',
   array(select id from public.candidaturas where cd_cargo = 7 and tipo = 'nominal' and numero = 50000),
   null::jsonb, null::char(5)),
  ('Dobrada · Guilherme Cortez (5005) e Bancada Feminista (50000)',
   array(select id from public.candidaturas where tipo = 'nominal'
         and ((cd_cargo = 6 and numero = 5005) or (cd_cargo = 7 and numero = 50000)) order by cd_cargo),
   null::jsonb, null::char(5))
) as v(titulo, ids, regra, mun)
where not exists (select 1 from public.paineis p where p.titulo = v.titulo and p.autor is null);
