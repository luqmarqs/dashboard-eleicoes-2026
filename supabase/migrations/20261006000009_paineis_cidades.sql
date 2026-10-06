-- Grupos e ordem dos painéis (para exibir os painéis prontos em destaque, agrupados).
alter table public.paineis add column if not exists grupo text;
alter table public.paineis add column if not exists ordem integer;

update public.paineis set grupo = 'PSOL · comparativos', ordem = case titulo
    when 'PSOL · 10 mais votados (federal e estadual)' then 1
    when 'PSOL em Campinas · 10 mais votados' then 2
    when 'PSOL em São Paulo (capital) · 10 mais votados' then 3 end
  where autor is null and regra is not null;
update public.paineis set grupo = 'Candidaturas em destaque', ordem = case
    when titulo like 'Paula da Bancada%' then 1 else 2 end
  where autor is null and regra is null and grupo is null;

-- Um painel por cidade, nas 10 cidades com mais votos de cada candidatura em destaque.
with alvo as (
  select c.id, c.numero, c.cd_cargo,
         case when c.numero = 50000 then 'Bancada Feminista' else 'Guilherme Cortez' end as nome
  from public.candidaturas c
  where c.tipo = 'nominal' and ((c.cd_cargo = 7 and c.numero = 50000) or (c.cd_cargo = 6 and c.numero = 5005))
), por_cidade as (
  select a.id, a.nome, a.numero, l.cd_municipio, sum(v.votos) as votos,
         row_number() over (partition by a.id order by sum(v.votos) desc) as pos
  from alvo a
  join public.votos_local v on v.candidatura_id = a.id
  join public.locais l on l.id = v.local_id
  group by a.id, a.nome, a.numero, l.cd_municipio
)
insert into public.paineis (titulo, candidatura_ids, regra, cd_municipio, autor, grupo, ordem)
select format('%s em %s', p.nome, initcap(lower(m.nome))), array[p.id], null, p.cd_municipio, null,
       format('%s · 10 cidades com mais votos', p.nome), p.pos
from por_cidade p
join public.municipios m on m.cd_municipio = p.cd_municipio
where p.pos <= 10
  and not exists (select 1 from public.paineis x
                  where x.autor is null and x.cd_municipio = p.cd_municipio and x.candidatura_ids = array[p.id]);
