-- Painéis prontos de Minas Gerais (foco: Iza Lourença, PSOL 50099, deputada estadual).
-- Idempotente: só insere o que ainda não existe. Depende dos dados de MG já carregados.

insert into public.paineis (titulo, candidatura_ids, regra, cd_municipio, autor, grupo, ordem, uf)
select v.titulo, v.ids, v.regra, v.mun, null, v.grupo, v.ordem, 'MG'
from (values
  ('PSOL · 10 mais votados em MG (federal e estadual)', '{}'::int[],
   '{"partido": "PSOL", "cargos": [6, 7], "top": 10}'::jsonb, null::char(5), 'PSOL · comparativos', 1),
  ('PSOL em Belo Horizonte · 10 mais votados', '{}'::int[],
   '{"partido": "PSOL", "cargos": [6, 7], "top": 10}'::jsonb, '41238'::char(5), 'PSOL · comparativos', 2),
  ('Iza Lourença (50099)',
   array(select id from public.candidaturas where uf = 'MG' and cd_cargo = 7 and tipo = 'nominal' and numero = 50099),
   null::jsonb, null::char(5), 'Candidaturas em destaque', 1),
  ('Dobrada · Lula (13) e Iza Lourença (50099)',
   array(select id from public.candidaturas where uf = 'MG' and tipo = 'nominal'
         and ((cd_cargo = 1 and numero = 13) or (cd_cargo = 7 and numero = 50099)) order by cd_cargo desc),
   null::jsonb, null::char(5), 'Candidaturas em destaque', 2)
) as v(titulo, ids, regra, mun, grupo, ordem)
where exists (select 1 from public.candidaturas where uf = 'MG')
  and not exists (select 1 from public.paineis p where p.titulo = v.titulo and p.autor is null and p.uf = 'MG');

-- Um painel por cidade, nas 10 cidades com mais votos da Iza.
with alvo as (
  select c.id from public.candidaturas c
  where c.uf = 'MG' and c.tipo = 'nominal' and c.cd_cargo = 7 and c.numero = 50099
), por_cidade as (
  select a.id, lo.cd_municipio, sum(u.q) as votos,
         row_number() over (order by sum(u.q) desc) as pos
  from alvo a
  join public.votos_cand v on v.candidatura_id = a.id
  cross join lateral unnest(v.locais, v.votos) as u(l, q)
  join public.locais lo on lo.id = u.l
  group by a.id, lo.cd_municipio
)
insert into public.paineis (titulo, candidatura_ids, regra, cd_municipio, autor, grupo, ordem, uf)
select format('Iza Lourença em %s', replace(replace(replace(replace(replace(initcap(lower(m.nome)),
         ' Do ', ' do '), ' Dos ', ' dos '), ' Da ', ' da '), ' Das ', ' das '), ' De ', ' de ')),
       array[p.id], null, p.cd_municipio, null, 'Iza Lourença · 10 cidades com mais votos', p.pos, 'MG'
from por_cidade p
join public.municipios m on m.cd_municipio = p.cd_municipio
where p.pos <= 10
  and not exists (select 1 from public.paineis x
                  where x.autor is null and x.uf = 'MG' and x.cd_municipio = p.cd_municipio and x.candidatura_ids = array[p.id]);
