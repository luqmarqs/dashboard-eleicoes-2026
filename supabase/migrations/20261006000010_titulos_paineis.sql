-- initcap deixa "Do", "Da", "Dos"... em maiúscula; nomes de cidade usam minúscula nessas partículas.
update public.paineis
set titulo = regexp_replace(titulo, ' (Da|Das|De|Do|Dos|E) ', ' ' || '\1' || ' ', 'g')
where autor is null and grupo like '%10 cidades%';
update public.paineis
set titulo = replace(replace(replace(replace(replace(titulo, ' Do ', ' do '), ' Dos ', ' dos '), ' Da ', ' da '), ' Das ', ' das '), ' De ', ' de ')
where autor is null and grupo like '%10 cidades%';
