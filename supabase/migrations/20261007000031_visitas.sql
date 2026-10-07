-- Log de visitas ao painel: quem (e-mail autorizado), quando, qual rota, UF, idioma e tipo de aparelho.
-- Não guarda IP nem user agent completo. A tabela é ilegível pela API (RLS sem políticas): o registro entra por
-- registrar_visita (qualquer e-mail autorizado, só o próprio) e a leitura sai por visitas_resumo, restrita a UM e-mail
-- (dono do painel), não a todos os administradores.

create table if not exists public.visitas (
  id          bigint generated always as identity primary key,
  email       text not null,
  visto_em    timestamptz not null default now(),
  rota        text not null,         -- caminho sem query string (ex.: /c/895)
  uf          char(2),
  lang        text,
  dispositivo text,                  -- 'celular' | 'desktop'
  sessao      text                   -- id aleatório por aba (sessionStorage), para contar sessões
);
create index if not exists visitas_visto_em on public.visitas (visto_em desc);
create index if not exists visitas_email on public.visitas (email, visto_em desc);
alter table public.visitas enable row level security;

create or replace function public.registrar_visita(p_rota text, p_uf text default null, p_lang text default null,
                                                   p_dispositivo text default null, p_sessao text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.autorizado() then
    return;  -- silencioso: quem não é da equipe não gera registro nem erro
  end if;
  insert into public.visitas (email, rota, uf, lang, dispositivo, sessao)
  values (public.email_atual(), left(coalesce(p_rota, '/'), 200), nullif(upper(left(coalesce(p_uf, ''), 2)), ''),
          left(p_lang, 5), left(p_dispositivo, 20), left(p_sessao, 40));
end $$;

-- único e-mail que enxerga o log (pedido explícito); mudar aqui e em dashboard/src/lib/visitas.ts
create or replace function public.dono_visitas()
returns boolean language sql stable set search_path = public as $$
  select public.email_atual() = 'luq.marqs@gmail.com';
$$;

create or replace function public.visitas_resumo(p_dias integer default 30)
returns json language plpgsql stable security definer set search_path = public as $$
declare desde timestamptz := now() - make_interval(days => greatest(coalesce(p_dias, 30), 1));
begin
  if not public.dono_visitas() then
    raise exception 'só o dono do painel pode ver as visitas' using errcode = '42501';
  end if;
  return json_build_object(
    'desde', desde,
    'totais', (select json_build_object('visitas', count(*), 'usuarios', count(distinct email), 'sessoes', count(distinct sessao))
               from visitas where visto_em >= desde),
    -- todos os e-mails autorizados, com a atividade no período e a última visita de qualquer época
    'por_usuario', (select coalesce(json_agg(json_build_object(
        'email', e.email, 'admin', e.admin, 'visitas', coalesce(v.visitas, 0), 'sessoes', coalesce(v.sessoes, 0),
        'dias_ativos', coalesce(v.dias, 0), 'primeira', v.primeira, 'ultima', u.ultima, 'rotas', coalesce(v.rotas, 0))
        order by u.ultima desc nulls last, e.email), '[]')
      from emails_autorizados e
      left join (select email, count(*) as visitas, count(distinct sessao) as sessoes, count(distinct visto_em::date) as dias,
                        min(visto_em) as primeira, count(distinct rota) as rotas
                 from visitas where visto_em >= desde group by email) v on v.email = e.email
      left join (select email, max(visto_em) as ultima from visitas group by email) u on u.email = e.email),
    'por_rota', (select coalesce(json_agg(json_build_object('rota', rota, 'visitas', n, 'usuarios', u) order by n desc), '[]')
                 from (select rota, count(*) as n, count(distinct email) as u from visitas where visto_em >= desde group by rota) r),
    'por_dia', (select coalesce(json_agg(json_build_object('dia', dia, 'visitas', n, 'usuarios', u) order by dia), '[]')
                from (select visto_em::date as dia, count(*) as n, count(distinct email) as u
                      from visitas where visto_em >= desde group by 1) d),
    'ultimas', (select coalesce(json_agg(json_build_object('email', email, 'visto_em', visto_em, 'rota', rota, 'uf', uf,
                                                           'lang', lang, 'dispositivo', dispositivo) order by visto_em desc), '[]')
                from (select * from visitas where visto_em >= desde order by visto_em desc limit 300) x));
end $$;

create or replace function public.visitas_limpar(p_dias integer)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.dono_visitas() then
    raise exception 'só o dono do painel pode apagar visitas' using errcode = '42501';
  end if;
  delete from visitas where visto_em < now() - make_interval(days => greatest(coalesce(p_dias, 30), 1));
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.registrar_visita(text, text, text, text, text), public.visitas_resumo(integer),
  public.visitas_limpar(integer), public.dono_visitas() from public, anon;
grant execute on function public.registrar_visita(text, text, text, text, text), public.visitas_resumo(integer),
  public.visitas_limpar(integer), public.dono_visitas() to authenticated;
