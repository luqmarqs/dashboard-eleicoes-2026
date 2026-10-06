# tse2026 — votação por seção eleitoral das Eleições Gerais 2026

Coletor reproduzível e reiniciável que reconstrói, **seção a seção**, os votos das Eleições
Gerais de 2026 a partir dos **Boletins de Urna oficiais** publicados pelo TSE em
`resultados.tse.jus.br`. Não usa scraping de HTML nem navegador automatizado, e não depende da
publicação futura do CSV "votação por seção" no Portal de Dados Abertos.

Cada linha do dataset é **seção × cargo × votável**: candidato, legenda, branco ou nulo. Os totais
são conferidos contra o resultado oficial agregado do TSE, por zona, município, UF e Brasil.

## De onde vêm os dados

| Dado | Fonte oficial |
|---|---|
| Pleito, eleições, cargos | `comum/config/ele-c.json` |
| Municípios (código TSE e IBGE), zonas | `<eleição>/config/mun-e<ele>-cm.json` |
| Seções de cada UF (inclui seções agregadas) | `arquivo-urna/<pleito>/config/<uf>/<uf>-p<pleito>-cs.json` |
| Arquivos de cada seção | `arquivo-urna/<pleito>/dados/<uf>/<mun>/<zona>/<secao>/…-aux.json` |
| **Votos da seção** | **Boletim de Urna** `…-bu.dat` (ou `…-busa.dat`), ASN.1/BER |
| Nomes, partidos, destinação dos votos e validação | resultado unificado `…-c<cargo>-e<ele>-u.json` |

Os detalhes da investigação (endpoints, hierarquia, exemplos reais e o que mudou em relação a
2022) estão em [docs/DISCOVERY.md](docs/DISCOVERY.md). Exemplos reais de cada arquivo estão em
[docs/samples/](docs/samples/).

> **Atenção:** a especificação ASN.1 oficial do BU de 2022 **não decodifica** os BUs de 2026. O
> coletor usa [`bu_2026.asn1`](src/tse2026/asn1/bu_2026.asn1), que é a especificação de 2022
> ajustada às diferenças observadas nos arquivos reais. Os campos novos estão marcados com
> `[2026]`. Os campos usados no dataset são validados contra o resultado oficial.

## Fluxo

```
DESCOBERTA      ele-c.json → pleito → mun-cm.json + cs.json → inventário de seções (SQLite + sections.parquet)
DOWNLOAD        aux.json da seção → escolhe o hash "Totalizado" → BU  → data/raw/   (async, reiniciável)
OFICIAIS        -u.json por BR/UF/município[/zona]                    → data/raw/metadata/
PARSE           BU (ASN.1) → staging por zona → Parquet por UF        → data/processed/  (sem rede)
VALIDAÇÃO       soma das seções × resultado oficial                    → data/validation/
```

O parse nunca baixa nada. Se o parser mudar, basta rodar `--parse --reparse`.

## Instalação

Requer Python 3.12+.

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
python -m pytest            # testes unitários (sem rede)
```

## Como executar

**Recomendado: comece por um recorte pequeno.**

```bash
python scripts/discover.py                                   # imprime pleito, UFs, municípios, zonas, seções
python scripts/run_pipeline.py --uf SP --municipio 71072 --zona 1 --all --dry-run   # só mostra o que baixaria
python scripts/run_pipeline.py --uf SP --municipio 71072 --zona 1 --all
```

Depois, uma UF inteira e, por fim, o país:

```bash
python scripts/run_pipeline.py --uf SP --all
python scripts/run_pipeline.py --all
```

Etapas isoladas: `--discover`, `--download`, `--official`, `--parse`, `--validate`, ou
`scripts/{discover,download,parse,validate}.py`. Filtros de escopo para debug: `--uf`,
`--municipio`, `--zona`, `--secao` e `--limit N`. Outras opções:

| Opção | Efeito |
|---|---|
| `--dry-run` | mostra o que seria baixado (contagens e URLs), sem baixar |
| `--turno 2` | 2º turno (quando o TSE publicar o pleito) |
| `--official-levels br,uf,municipio,zona` | níveis de resultado oficial a baixar. O padrão é `br,uf,municipio`; com `zona` a validação fica mais fina, mas são mais requisições |
| `--reparse` | refaz o parse de todas as zonas do escopo |
| `--refresh-aux` / `--refresh-official` | baixa de novo arquivos que o TSE pode atualizar |
| `--concurrency N` | sobrescreve `MAX_CONCURRENCY` |
| `--workers N` | processos usados no parse (padrão: CPUs − 1) |

### Configuração

Variáveis de ambiente, com prefixo `TSE2026_` opcional:

| Variável | Padrão | |
|---|---|---|
| `MAX_CONCURRENCY` | 12 | requisições simultâneas (conservador; recomendado de 10 a 20) |
| `REQUEST_TIMEOUT` | 30 | segundos |
| `MAX_RETRIES` | 5 | tentativas extras em 429/5xx/timeout/conexão/arquivo truncado/JSON malformado |
| `BACKOFF_FACTOR` | 1.0 | base do backoff exponencial com jitter (máximo de 60 s) |
| `DATA_DIR` | `data` | raiz dos dados |

Um HTTP 404 nunca é retentado. Se mais de 50% das últimas 200 requisições derem 404, o download
**para** (`TooManyNotFoundError`), porque isso indica URL ou estrutura errada. Os 404 esperados
(ex.: Deputado Distrital fora do DF) são marcados como `not_found` e não acionam o disjuntor. Um
HTTP 429 pausa todas as requisições pelo tempo indicado em `Retry-After`.

### Volume esperado (país inteiro, 1º turno)

| | |
|---|---|
| Seções / BUs | 517.179 seções, das quais ~499 mil com BU próprio |
| Requisições | ~1 milhão (aux.json + BU), mais ~35 mil resultados oficiais por município |
| Tempo de download | cerca de 6 h com 12 conexões (medido: ~46 requisições/s) |
| Dados brutos | ~9 GB de BUs + ~0,3 GB de aux.json |
| Parse | ~8 ms por BU em cada processo |
| Parquet final | da ordem de centenas de MB (o AC, com 258 mil linhas, ocupa 1,1 MB) |

## Retomada (checkpoint)

O estado fica em `data/manifests/state.sqlite`, com escrita incremental e commit a cada 200 seções.
**Basta repetir o mesmo comando** depois de uma interrupção (Ctrl+C, queda de rede, reboot):

- seções `downloaded`, `parsed` ou `validated` não são baixadas de novo;
- antes de baixar, o arquivo local é conferido (existência, tamanho e SHA-256 do manifest). Se o
  arquivo estiver ausente ou corrompido, é baixado de novo;
- seções que ficaram em `downloading` voltam para `pending`;
- seções com `error` são tentadas de novo (use `--no-retry-errors` para pular);
- seções "sem BU" são reavaliadas (o BU pode ser publicado depois).

Estados de seção: `pending → downloading → downloaded → parsed → validated`, além de `error` e
`skipped` (seção agregada ou sem BU totalizado, com o motivo em `status_reason`).

Os manifests em Parquet são exportados ao fim de cada etapa:

| Arquivo | Conteúdo |
|---|---|
| `data/manifests/sections.parquet` | inventário e lista de trabalho: UF, município, zona, seção, status, `metadata_url`, `ballot_url`… |
| `data/manifests/files.parquet` | cada arquivo baixado: url, uf/município/zona/seção, tipo, caminho, sha256, http_status, bytes, downloaded_at, status |
| `data/manifests/errors.parquet` | todos os erros restantes (seções e arquivos) |

Os arquivos brutos ficam em `data/raw/{metadata,sections,ballots}/`, espelhando o caminho da
URL. **Nada é sobrescrito silenciosamente**: se o TSE alterar um arquivo, a versão anterior é
movida para `_history/` ao lado dele.

## Formato e schema

### Dataset principal: `data/processed/votacao_secao_2026/`

Parquet com compressão ZSTD, particionado por UF no estilo Hive (`SG_UF=SP/turno1_0.parquet`) e
ordenado por município, zona, seção, cargo, tipo de voto e número. Arquivos acima de ~400 MB são
divididos (`turno1_1.parquet`, …).

<a id="schema"></a>

| Coluna | Tipo | Descrição |
|---|---|---|
| ANO_ELEICAO | int16 | 2026 |
| CD_PLEITO | int32 | código do pleito no TSE (3220 no 1º turno) |
| CD_ELEICAO | int32 | 6257 federal, 6259 estadual, 6261 municipal (Noronha) |
| NR_TURNO | int8 | |
| DT_ELEICAO | date | |
| SG_UF | string (partição) | inclui `ZZ` (exterior) |
| CD_MUNICIPIO | string | código TSE com 5 dígitos, **zeros à esquerda preservados** (`01120`) |
| CD_MUNICIPIO_IBGE | int32 | código IBGE (`cdi` do arquivo de municípios) |
| NM_MUNICIPIO | string | |
| NR_ZONA, NR_SECAO | int32 | |
| NR_LOCAL_VOTACAO | int32 | local de votação, tirado do BU |
| CD_CARGO | int16 | 1 Presidente, 3 Governador, 5 Senador, 6 Dep. Federal, 7 Dep. Estadual, 8 Dep. Distrital, 25 Conselheiro Distrital |
| DS_CARGO, TP_CARGO | string (dicionário) | TP_CARGO: majoritario / proporcional |
| TP_VOTO | string (dicionário) | `nominal`, `legenda`, `branco`, `nulo` |
| NR_CANDIDATO | int32 | número votado. Na legenda é o número do partido; nulo em branco/nulo |
| NR_PARTIDO | int16 | partido, conforme o BU |
| SG_PARTIDO | string (dicionário) | sigla, do resultado oficial |
| NM_CANDIDATO, NM_URNA_CANDIDATO | string | do resultado oficial; NULL se o candidato não constar dele |
| SQ_CANDIDATO | int64 | sequencial do candidato no TSE |
| DS_DESTINACAO_VOTO | string (dicionário) | destinação oficial (`dvt`): `Válido`, `Válido (legenda)`, `Anulado sub judice`…; NULL quando o votável não consta do resultado oficial (nulo técnico) |
| **QT_VOTOS** | int32 | votos daquele votável na seção |
| QT_APTOS | int32 | eleitores aptos da seção (na eleição do cargo) |
| QT_COMPARECIMENTO | int32 | comparecimento da seção para o cargo |
| QT_ABSTENCOES | int32 | QT_APTOS − QT_COMPARECIMENTO |
| QT_VOTOS_NOMINAIS, QT_VOTOS_LEGENDA, QT_BRANCOS, QT_NULOS | int32 | totais da seção para o cargo, segundo o BU |

As colunas `QT_APTOS` … `QT_NULOS` repetem-se em todas as linhas do mesmo cargo na seção. Para
somá-las, use `DISTINCT` por seção e cargo (veja os exemplos abaixo).

**Chave natural**, verificada na validação (zero duplicatas):
`ANO_ELEICAO, NR_TURNO, SG_UF, CD_MUNICIPIO, NR_ZONA, NR_SECAO, CD_CARGO, TP_VOTO, NR_CANDIDATO`.
`TP_VOTO` precisa entrar na chave porque brancos e nulos não têm número e porque o voto de legenda
13 é diferente do voto nominal 13. Se um dia houver 2º turno, ele fica em arquivos `turno2_*.parquet`
da mesma partição.

> **Senado:** em 2026 são duas vagas por UF e cada eleitor vota duas vezes. Por isso a soma de
> `QT_VOTOS` no cargo 5 é cerca de 2 × o comparecimento.

### Dataset de seções: `data/processed/secoes_2026/`

Uma linha por seção × eleição. Inclui as seções **sem BU**, como agregadas, não instaladas ou com
erro. Serve para identificar situações especiais: `DS_STATUS_COLETA`, `DS_MOTIVO_STATUS`,
`ST_AGREGADA`, `NR_SECAO_PRINCIPAL`, `NR_SECOES_AGREGADAS`, `DS_SITUACAO_AUX`, `DS_SITUACAO_BU`,
`QT_HASHES` (BU reenviado), `TP_URNA` (`secao`, `contingencia`, `reservaSecao`…), `TP_ARQUIVO`
(`votacaoUE`, `saManual`…), `TP_ORIGEM_BU` (`dadosSecao` para urna, `dadosSA` para Sistema de
Apuração), `DS_MOTIVO_SA`, junta/turma apuradora, número da urna, código e data da carga, versão do
software, abertura/encerramento, aptos, comparecimento, `BU_SHA256` e `BU_URL`.

### Metadados: `data/processed/metadata.json`

Data de geração, versão do coletor, commit git, fonte, eleição, pleito, turno, contagens de UFs,
municípios, zonas, seções e registros, inventário por status, arquivos com erro e resultado da
validação.

## Consultas

### DuckDB

```sql
-- Votos do 13 nas seções de SP
SELECT SG_UF, NM_MUNICIPIO, NR_ZONA, NR_SECAO, NM_URNA_CANDIDATO, QT_VOTOS
FROM read_parquet('data/processed/votacao_secao_2026/**/*.parquet', hive_partitioning = true)
WHERE SG_UF = 'SP' AND NR_CANDIDATO = 13 AND DS_CARGO = 'Presidente'
ORDER BY QT_VOTOS DESC
LIMIT 100;

-- Agregação por município
SELECT NM_MUNICIPIO, SUM(QT_VOTOS) AS votos
FROM read_parquet('data/processed/votacao_secao_2026/**/*.parquet', hive_partitioning = true)
WHERE SG_UF = 'SP' AND NR_CANDIDATO = 13 AND DS_CARGO = 'Presidente'
GROUP BY NM_MUNICIPIO
ORDER BY votos DESC;

-- Comparecimento, abstenção, brancos e nulos por zona (um registro por seção × cargo)
SELECT NR_ZONA, SUM(QT_APTOS) aptos, SUM(QT_COMPARECIMENTO) comparecimento,
       SUM(QT_ABSTENCOES) abstencoes, SUM(QT_BRANCOS) brancos, SUM(QT_NULOS) nulos
FROM (SELECT DISTINCT SG_UF, CD_MUNICIPIO, NR_ZONA, NR_SECAO, CD_CARGO, QT_APTOS,
             QT_COMPARECIMENTO, QT_ABSTENCOES, QT_BRANCOS, QT_NULOS
      FROM read_parquet('data/processed/votacao_secao_2026/**/*.parquet', hive_partitioning = true)
      WHERE SG_UF = 'SP' AND CD_CARGO = 1)
GROUP BY NR_ZONA ORDER BY NR_ZONA;

-- Por local de votação (útil para JOIN geográfico posterior)
SELECT CD_MUNICIPIO, NR_ZONA, NR_LOCAL_VOTACAO, NR_CANDIDATO, SUM(QT_VOTOS) votos
FROM read_parquet('data/processed/votacao_secao_2026/**/*.parquet', hive_partitioning = true)
WHERE SG_UF = 'RJ' AND CD_CARGO = 3 AND TP_VOTO = 'nominal'
GROUP BY ALL;
```

### Polars

```python
import polars as pl

lf = pl.scan_parquet("data/processed/votacao_secao_2026/**/*.parquet", hive_partitioning=True)
(
    lf.filter((pl.col("SG_UF") == "SP") & (pl.col("CD_CARGO") == 1) & (pl.col("TP_VOTO") == "nominal"))
      .group_by("NM_URNA_CANDIDATO")
      .agg(pl.col("QT_VOTOS").sum())
      .sort("QT_VOTOS", descending=True)
      .collect()
)
```

Também funciona com PyArrow (`pyarrow.dataset.dataset(path, partitioning="hive")`) e Pandas
(`pd.read_parquet(path, filters=[("SG_UF", "==", "SP")])`).

## Exportar CSV

O CSV é sempre gerado sob demanda e por recorte. Não há CSV nacional por padrão.

```bash
python scripts/export_csv.py --uf SP
python scripts/export_csv.py --uf SP --municipio 71072
python scripts/export_csv.py --cargo presidente
python scripts/export_csv.py --uf RJ --cargo "deputado federal" --zona 5 --out rj.csv
```

Os arquivos vão para `data/exports/`, com separador `;` (mude com `--sep`).

## Como funciona a validação

Os votos das seções são agregados por **zona → município → UF → Brasil** e comparados, para cada
eleição × cargo, com os arquivos oficiais `-u.json`. Só entram na comparação os níveis cujo
arquivo oficial foi baixado.

| Comparação | Seções (BU) | Oficial |
|---|---|---|
| candidato | Σ votos nominais do número | `vap` do candidato |
| legenda | Σ votos de legenda do partido | `tvtl` (ou `tval`, se a legenda estiver anulada) |
| QT_APTOS / QT_COMPARECIMENTO / QT_ABSTENCOES | Σ por seção | `e.te` / `e.c` / `e.a` |
| QT_VOTOS_TOTAL | Σ QT_VOTOS | `v.tv` |
| QT_VOTOS_NOMINAIS_VALIDOS / QT_VOTOS_LEGENDA_VALIDOS | nominal/legenda com destinação `Válido…` | `v.vnom` / `v.vl` |
| QT_BRANCOS / QT_NULOS | branco / nulo do BU | `v.vb` / `v.vn` |
| QT_NULOS_TECNICOS | votos em votáveis ausentes do resultado oficial | `v.vnt` |
| QT_ANULADOS / QT_ANULADOS_SUB_JUDICE | destinação `Anulado` / `Anulado sub judice` | `v.van` / `v.vansj` |

Os resultados vão para `data/validation/`:

| Arquivo | Conteúdo |
|---|---|
| `comparisons.parquet` | todas as comparações: nivel, uf, municipio, zona, cd_eleicao, cd_cargo, tipo, metrica, candidato, votos_secoes, votos_oficial, diferenca_absoluta, diferenca_percentual, secoes_faltantes, status |
| `differences.parquet` | só as comparações com status diferente de `OK` |
| `validation_summary.parquet` | contagem por nível × tipo × status |

| Status | Significado |
|---|---|
| `OK` | soma das seções = oficial |
| `DIFFERENCE` | divergência com todas as seções do escopo processadas. **É um problema real** |
| `MISSING_SECTIONS` | divergência explicada por seções ainda não baixadas ou parseadas no escopo |
| `MISSING_OFFICIAL_DATA` | não há número oficial para comparar |
| `NULO_TECNICO` | votável presente no BU mas ausente do resultado oficial (ex.: candidatura indeferida). O TSE conta esses votos como nulos técnicos, conferidos no agregado por `QT_NULOS_TECNICOS` |

A validação também checa a unicidade da chave natural. O comando termina com código 1 se houver
`DIFFERENCE` ou duplicatas. Municípios sem nenhuma divergência têm as seções marcadas como
`validated`.

### Resultados dos testes de ponta a ponta (06/10/2026)

| Recorte | Seções | Resultado |
|---|---|---|
| SP / São Paulo / zona 1 | 449 | zona: 2.421 candidatos, 54 legendas e 52 totais **idênticos** ao oficial |
| AC (UF inteira) | 2.411 (141 agregadas) | zona, município e UF: 100% `OK` (7.705 + 897 + 1.196 comparações por zona); 0 duplicatas |
| PE / Fernando de Noronha | 10 | 100% `OK`, inclusive Conselheiro Distrital (eleição municipal 6261) |
| ZZ / Katmandu | 1 (apuração manual, `busa`) | 100% `OK` |

## Limitações conhecidas

- **ASN.1 de 2026 inferido.** A especificação oficial de 2026 não estava acessível de forma
  automatizada. Os campos usados foram validados contra os totais oficiais, mas os campos novos de
  semântica não documentada (`identificacaoCarga`, `habilitacaoEleitores`, contadores extras) são
  apenas preservados. Um formato de BU que não decodifique vira `error` na seção, aparece em
  `errors.parquet` e não derruba o pipeline.
- **Nomes de candidatos e destinação do voto** vêm do resultado oficial (`-u.json`) por UF. Se ele
  não tiver sido baixado (`--official`), essas colunas ficam NULL. Basta rodar
  `--official --parse --reparse`, sem novo download de BUs.
- **Nulo técnico** é identificado pela ausência do votável no resultado oficial. A classificação
  é conferida no agregado (`vnt`), mas não existe um campo por candidato que a afirme diretamente.
- Só o BU é baixado. O RDV (registro digital do voto), os logs e os arquivos de assinatura não são
  baixados, e a assinatura digital do BU **não é verificada**.
- O 2º turno será coletado com `--turno 2` assim que o TSE publicar o pleito no `ele-c.json`.
- A documentação técnica do TSE (`www.tse.jus.br`) bloqueia clientes automatizados (HTTP 403).
- Os valores de resultados oficiais são os do momento do download. Use `--refresh-official` para
  atualizar após uma retotalização.

## Estrutura do código

```
src/tse2026/
  config.py       configuração centralizada (variáveis de ambiente)
  endpoints.py    único lugar onde URLs do TSE são montadas
  client.py       HTTP assíncrono: retry exponencial + jitter, 429/5xx, disjuntor de 404
  fetcher.py      download → RawStore → manifest, com reaproveitamento por hash
  storage.py      arquivos brutos (atômico, versionado em _history/)
  manifest.py     estado SQLite + exportação dos manifests Parquet
  discovery.py    pleito, municípios, inventário de seções
  download.py     fila assíncrona de seções; resultados oficiais
  bu.py           decodificação do BU (asn1/bu_2026.asn1)
  official.py     leitura dos -u.json (candidatos, partidos, totais)
  schemas.py      schemas PyArrow explícitos
  parser.py       BU → staging por zona (multiprocesso) → Parquet consolidado (DuckDB)
  validation.py   comparação com os resultados oficiais (DuckDB)
  cli.py          linha de comando
scripts/          run_pipeline.py, discover.py, download.py, parse.py, validate.py, export_csv.py
tests/            testes unitários (fixtures com BU/JSON reais de 2026)
docs/             DISCOVERY.md + amostras reais
```
