-- Gestão de acessos pelo dashboard: administradores incluem e removem e-mails autorizados.
-- A tabela continua ilegível pela API; tudo passa por funções SECURITY DEFINER que checam o papel.

alter table public.emails_autorizados add column if not exists admin boolean not null default false;
alter table public.emails_autorizados add column if not exists incluido_por text;
update public.emails_autorizados set admin = true where email = 'luq.marqs@gmail.com';

create or replace function public.email_atual()
returns text language sql stable set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.sou_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.emails_autorizados where email = public.email_atual() and admin);
$$;

create or replace function public.listar_autorizados()
returns table (email text, admin boolean, incluido_em timestamptz, incluido_por text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sou_admin() then
    raise exception 'apenas administradores podem ver a lista de acessos' using errcode = '42501';
  end if;
  return query select e.email, e.admin, e.incluido_em, e.incluido_por
               from public.emails_autorizados e order by e.admin desc, e.email;
end $$;

create or replace function public.adicionar_autorizado(p_email text, p_admin boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if not public.sou_admin() then
    raise exception 'apenas administradores podem incluir acessos' using errcode = '42501';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'e-mail inválido: %', p_email using errcode = '22023';
  end if;
  insert into public.emails_autorizados (email, admin, incluido_por)
  values (e, coalesce(p_admin, false), public.email_atual())
  on conflict (email) do update set admin = excluded.admin;
end $$;

create or replace function public.remover_autorizado(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(p_email));
begin
  if not public.sou_admin() then
    raise exception 'apenas administradores podem remover acessos' using errcode = '42501';
  end if;
  if e = public.email_atual() then
    raise exception 'você não pode remover o próprio acesso' using errcode = '22023';
  end if;
  delete from public.emails_autorizados where email = e;
end $$;

revoke execute on function public.email_atual(), public.sou_admin(), public.listar_autorizados(),
  public.adicionar_autorizado(text, boolean), public.remover_autorizado(text) from public, anon;
grant execute on function public.email_atual(), public.sou_admin(), public.listar_autorizados(),
  public.adicionar_autorizado(text, boolean), public.remover_autorizado(text) to authenticated;
