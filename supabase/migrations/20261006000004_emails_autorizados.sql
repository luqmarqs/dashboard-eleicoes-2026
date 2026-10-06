-- Lista de e-mails autorizados. Qualquer pessoa pode receber o link de login, mas só e-mails desta
-- lista enxergam dados (RLS). Para autorizar alguém:
--   insert into public.emails_autorizados (email) values ('pessoa@exemplo.org');

create table if not exists public.emails_autorizados (
  email      text primary key check (email = lower(email)),
  incluido_em timestamptz not null default now()
);
alter table public.emails_autorizados enable row level security;
-- sem políticas: a lista não é legível pela API; a checagem é feita pela função abaixo.

create or replace function public.autorizado()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.emails_autorizados
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke execute on function public.autorizado() from public, anon;
grant execute on function public.autorizado() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['municipios', 'locais', 'candidaturas', 'votos_local', 'totais_local',
                           'partidos_destaque', 'candidaturas_destaque', 'paineis']
  loop
    execute format('drop policy if exists "equipe le" on public.%I', t);
    execute format('create policy "equipe le" on public.%I for select to authenticated using (public.autorizado())', t);
  end loop;
end $$;

drop policy if exists "autor cria" on public.paineis;
create policy "autor cria" on public.paineis for insert to authenticated
  with check (autor = auth.uid() and public.autorizado());
drop policy if exists "autor edita" on public.paineis;
create policy "autor edita" on public.paineis for update to authenticated
  using (autor = auth.uid() and public.autorizado()) with check (autor = auth.uid() and public.autorizado());
drop policy if exists "autor apaga" on public.paineis;
create policy "autor apaga" on public.paineis for delete to authenticated
  using (autor = auth.uid() and public.autorizado());

insert into public.emails_autorizados (email) values ('luq.marqs@gmail.com') on conflict do nothing;
