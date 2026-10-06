-- O dashboard sempre filtra votos por candidatura (prefixo da chave primária); o índice por local
-- não é usado e ocupa ~100 MB com 4,6 milhões de linhas.
drop index if exists public.votos_local_local;
