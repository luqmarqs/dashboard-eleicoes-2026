-- A migration 32 criou meta_atualizar_cache(char, boolean); a versão de um argumento continuava existindo e a chamada
-- meta_atualizar_cache('SP') ficou ambígua. Só a nova (incremental) fica.
drop function if exists public.meta_atualizar_cache(char);
