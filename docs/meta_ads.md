# Tráfego pago — Biblioteca de Anúncios da Meta

Coleta, pela API oficial `ads_archive` (Graph API **v26.0**, a mais recente na documentação em 07/10/2026), dos anúncios
políticos das candidaturas **eleitas** em SP, MG e RS, mais a Manuela (Senado/RS). Os dados vão para o Supabase e aparecem
na página **Publicidade** do dashboard.

> A Manuela **não fez tráfego pago próprio**: nenhuma página dela anunciou. O que existe são anúncios de outras campanhas que
> usaram por conta própria o nome e o número dela ("anúncios de terceiros" no painel; o gasto é de quem pagou). A análise desses
> anúncios é mantida, mas nunca como gasto da candidatura.

## O que a API devolve para anúncios políticos no Brasil (verificado em respostas reais)

| Campo | Situação | Observação |
|---|---|---|
| `target_locations` | preenchido em 100% dos anúncios | lista `{name, type, excluded, num_obfuscated}`; **sem ID geográfico** da Meta |
| tipos de localidade | `countries`, `regions` (UF), `CITY`, `MUNICIPALITY`, `NEIGHBORHOOD`, `zips` | CEP só com 5 dígitos |
| `delivery_by_region` | ~85% | proporção do alcance **por UF** — não há entrega por cidade |
| `total_reach_by_location` | 100% | só o país (`BR`) |
| `spend`, `impressions` | 100% | faixas acumuladas por anúncio; teto pode faltar (faixa aberta) |
| `br_total_reach`, `estimated_audience_size` | 100% | estimativas por anúncio |
| `demographic_distribution`, `age_country_gender_reach_breakdown` | preenchidos | guardados na resposta bruta |
| `ad_snapshot_url` | 100% | **traz o token na URL**: não é guardado; usa-se o link público `facebook.com/ads/library/?id=` |
| `media_type` | vazio na amostra | |
| datas | só AAAA-MM-DD | criação, início e fim de veiculação |

Resolução geográfica: **cidade confirmada** (nome + UF, ex. "Várzea Da Palma, Brazil, MG, Brasil"); **bairro existe**
(`NEIGHBORHOOD`), às vezes com a cidade ("Boa Esperança, Belo Horizonte, MG") e às vezes sem ("Barreiro, MG") — o bairro
não é ligado aos bairros do TSE (não há chave comum); só a cidade do bairro, quando informada, é validada.

## Regras

- **Segmentação ≠ entrega ≠ votação.** Segmentar uma cidade não prova exposição; a entrega só existe por UF; o cruzamento
  com votos é descritivo.
- **Município**: nome + UF comparados ao cadastro do IBGE (após normalizar acentos, caixa, hífen e apóstrofo); vale só
  correspondência única na UF. O código TSE vem do cadastro do painel (`cd_ibge → cd_municipio`).
- **Página ↔ candidatura**: confirmada quando o financiador declarado (`bylines`) é o CNPJ de campanha, no formato
  "ELEIÇÃO 2026 <nome completo no TSE> <cargo|CNPJ|fim>". Casos com nome social ou financiador fora do padrão ficam
  "a revisar" em `config/meta_paginas_revisao.csv` (coletados, mas exibidos como não confirmados).
- **Faixas**: somam-se limites (Σmin–Σmax); teto ausente deixa o total sem teto; moedas não se misturam; alcance não se soma.
- **Vários territórios**: o anúncio conta uma vez em cada cidade que inclui; o gasto nunca é dividido nem atribuído a ela.
- **Tempo**: o filtro de datas escolhe anúncios que circularam no período; as métricas continuam sendo o acumulado do anúncio.

## Como rodar

```bash
# token de curta duração do Explorador da Graph API (não versionar)
echo "META_ACCESS_TOKEN=..." > .env.meta.local

PYTHONPATH=src python -m meta_ads descobrir           # busca páginas das eleitas (retomável) -> data/meta_ads/descoberta.csv
PYTHONPATH=src python -m meta_ads vincular            # + relatório FacebookAdLibraryReport_*.zip na raiz, se houver
PYTHONPATH=src python -m meta_ads coletar --completa  # desde 16/08/2026
PYTHONPATH=src python -m meta_ads coletar             # incremental: reconsulta os últimos 14 dias
PYTHONPATH=src python -m meta_ads coletar --retomar <id_execucao>
PYTHONPATH=src python -m meta_ads exportar --supabase # dev-data + carga no Supabase
```

Atualização periódica: não há agendador no projeto. O mais simples é rodar `coletar` + `exportar --supabase` à mão (o token
expira em horas). Para agendar sem custo, um GitHub Actions com cron exigiria um token de longa duração (60 dias, via
"Estender token" no Depurador de Token de Acesso) e as credenciais do Supabase como segredos do repositório.

## Variáveis de ambiente (backend)

- `META_ACCESS_TOKEN` — token de acesso à Biblioteca de Anúncios (ou `.env.meta.local`, ignorado pelo git)
- `META_GRAPH_API_VERSION` — opcional; padrão `v26.0`

O dashboard não recebe nenhuma credencial da Meta: lê só as tabelas `meta_*` do Supabase (RLS: e-mails autorizados).

## Tabelas (Supabase, migração 20261007000017)

`meta_vinculos`, `meta_anuncios`, `meta_observacoes` (histórico, resposta bruta saneada), `meta_localidades`
(segmentação), `meta_entrega_regional` (entrega por UF), `meta_execucoes` (cobertura de cada rodada);
RPCs `meta_resumo_json(uf)` e `meta_anuncios_json(candidatura_id)`.
