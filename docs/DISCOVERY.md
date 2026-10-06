# Descoberta da estrutura de divulgação — Eleições Gerais 2026

Investigação feita em 06/10/2026 (dois dias após o 1º turno de 04/10/2026) diretamente em
`https://resultados.tse.jus.br/oficial/`. Exemplos reais estão em [`docs/samples/`](samples/).

> A página de documentação técnica do TSE (`www.tse.jus.br/eleicoes/...`) responde HTTP 403 a
> clientes automatizados. Por isso, a estrutura abaixo foi levantada **inspecionando os arquivos
> reais** e o código público do app de resultados (`/oficial/app/*.js`), que monta as URLs.

## 1. Endpoints encontrados (2026)

Base: `https://resultados.tse.jus.br/oficial` (ambiente `oficial`, ciclo `ele2026`).

| Arquivo | URL | Conteúdo |
|---|---|---|
| Configuração geral | `/comum/config/ele-c.json` | Pleitos, eleições, cargos e abrangências (inclui padrões de diretório em `arq`) |
| Municípios (EA12) | `/ele2026/<ele>/config/mun-e<ele6>-cm.json` | UF → municípios (código TSE, código IBGE `cdi`, nome, capital, zonas) |
| Seções por UF | `/ele2026/arquivo-urna/<pleito>/config/<uf>/<uf>-p<pleito6>-cs.json` | UF → município → zona → seções (com data/hora de recebimento e agregações) |
| Arquivos da seção | `/ele2026/arquivo-urna/<pleito>/dados/<uf>/<mun5>/<zona4>/<secao4>/p<pleito6>-<uf>-m<mun5>-z<zona4>-s<secao4>-aux.json` | Lista de hashes e arquivos da urna (BU, RDV, log, VSC) |
| BU da seção | `.../<secao4>/<hash>/o<pleito5><uf><mun5><zona4><secao4>-bu.dat` (ou `-busa.dat`) | **Boletim de Urna (ASN.1/BER)** — votos da seção |
| Resultado "unificado" | `/ele2026/<ele>/dados/<uf>/<uf>[<mun5>][-z<zona4>]-c<cargo4>-e<ele6>-u.json` | Resultado oficial agregado por BR/UF/município/**zona**, com candidatos, partidos e totais |
| Acompanhamento | `/ele2026/<ele>/dados/<uf>/<uf>-e<ele6>-ab.json` | Andamento da totalização por abrangência |

Pleito e eleições identificados no `ele-c.json`:

| Pleito | Data | Eleição | Nome | Cargos |
|---|---|---|---|---|
| 3220 | 04/10/2026 | 6257 (tp 8) | Eleição Ordinária Federal - 1º Turno | 1 Presidente |
| | | 6259 (tp 1) | Eleição Ordinária Estadual - 1º Turno | 3 Governador, 5 Senador, 6 Dep. Federal, 7 Dep. Estadual, 8 Dep. Distrital |
| | | 6261 (tp 3) | Eleição Ordinária Municipal | 25 Conselheiro Distrital (Fernando de Noronha) |

As eleições 6257/6259 já anunciam o 2º turno (`cdt2` = 6258/6260); o pleito do 2º turno ainda
não constava do `ele-c.json` em 06/10. O coletor escolhe o pleito automaticamente por
`ciclo = ele2026`, tipo de eleição geral (8/1) e turno — nada é fixo no código.

## 2. Hierarquia

```
ele-c.json
└── pleito 3220 (ciclo ele2026, 04/10/2026)
    ├── eleição 6257 / 6259 / 6261 ──> cargos
    │     └── mun-e<ele>-cm.json: UF → município (TSE 5 dígitos + IBGE) → zonas
    └── arquivo-urna/3220/config/<uf>/<uf>-p003220-cs.json
          └── UF → município → zona → seção  (ns, nsa = seções agregadas, nsp = principal)
                └── aux.json da seção → hash(es) → arquivos: bu | busa | rdv | log | vota | ...
```

**Um único BU por seção cobre todas as eleições do pleito** (o BU da seção 1 da zona 1 de São
Paulo traz Presidente da eleição 6257 e Governador/Senador/Deputados da 6259).

Totais nacionais (descoberta de 06/10/2026): **28 UFs** (27 + ZZ/exterior), **5.757 municípios**
(186 no exterior), **2.641 zonas**, **517.179 seções**, das quais **17.931 agregadas** (sem BU
próprio) → **~499 mil BUs**.

## 3. Exemplo real de uma seção (SP / São Paulo 71072 / zona 1 / seção 1)

`aux.json` ([amostra](samples/p003220-sp-m71072-z0001-s0001-aux.json)):

```json
{ "st": "Totalizada", "hashes": [ { "hash": "3679…733d", "st": "Totalizado", "arq": [
  { "nm": "o03220sp7107200010001-vota.vsc", "tp": "vota" },
  { "nm": "o03220sp7107200010001-bu.dat",   "tp": "bu" },
  { "nm": "o03220sp7107200010001-log.jez",  "tp": "log" },
  { "nm": "o03220sp7107200010001-rdv.dat",  "tp": "rdv" } ] } ] }
```

BU decodificado ([amostra completa](samples/bu_sp_71072_z0001_s0001.decoded.json)), cargo Presidente:

| Tipo | Número | Votos |
|---|---|---|
| nominal | 13 (LULA) | 121 |
| nominal | 22 (FLAVIO BOLSONARO) | 96 |
| nominal | 55 | 13 |
| nominal | 14 | 7 |
| nominal | 70 | 4 |
| nominal | 30 | 3 |
| nominal | 80 | 1 |
| nulo | — | 9 |
| branco | — | 2 |

Aptos 362, comparecimento 256 (abstenção 106), local de votação 1015, urna aberta 08:00:01 e
encerrada 17:08:42.

## 4. Arquivo que contém a votação da seção

O **`-bu.dat`** (Boletim de Urna em ASN.1/BER, envelope `EntidadeEnvelopeGenerico` contendo
`EntidadeBoletimUrna`). Quando a seção foi apurada pelo **Sistema de Apuração** (votação
manual/cédulas, comum no exterior), o arquivo se chama **`-busa.dat`**, no mesmo formato, com
`dadosSA` em vez de `dadosSecao`.

Não existe JSON oficial com votos **por seção** em 2026; os `-u.json` descem no máximo até a
**zona** — por isso são usados para nomes e para a validação, nunca como fonte dos votos.

### Diferenças em relação à documentação/arquivos de eleições anteriores

| Item | Antes (2022) | 2026 (observado) |
|---|---|---|
| Nome do BU | `o00406-7107200010001.bu` | `o03220sp7107200010001-bu.dat` |
| BU em texto (`.imgbu`) | publicado | **não publicado** (404) |
| Resultados agregados | `-v.json` (variável) + `-f.json` (fixo) | **`-u.json` unificado** (inclui nível zona) |
| Especificação ASN.1 do BU | `bu.asn1` de 2022 | **incompatível** — ver abaixo |

Mudanças no ASN.1 inferidas a partir da estrutura BER de BUs reais (arquivo
[`src/tse2026/asn1/bu_2026.asn1`](../src/tse2026/asn1/bu_2026.asn1), campos marcados `[2026]`):

1. `Carga`: novo `SEQUENCE OF GeneralString` entre `numeroSerieFC` e `dataHoraCarga`
   (ex.: `["ZSP001STD29","6B8DFAFE","50F717EF"]`).
2. `EntidadeBoletimUrna`: os opcionais `[1] qtdEleitoresLibCodigo` / `[2] qtdEleitoresCompBiometrico`
   foram substituídos por um `INTEGER` (comparecimento da urna) + `[1] SEQUENCE OF INTEGER`
   (ex.: `{7, 212, 37}`, soma = comparecimento); `resultadosVotacaoPorEleicao` perdeu a tag `[3]`;
   `chaveAssinaturaVotosVotavel` saiu e entrou uma lista de códigos de carga ao final.
3. `ResultadoVotacaoPorEleicao`: dois contadores novos após `qtdEleitoresAptos` (iguais/zero nas
   amostras) e duas `OCTET STRING` (assinaturas) ao final.
4. `TotalVotosVotavel`: novo `INTEGER` ordinal antes de `assinatura`.

Os campos cuja semântica não está documentada são preservados com nomes descritivos e **não são
usados** no dataset de votos, exceto `qtdEleitoresAptos` — cuja soma foi validada contra o
eleitorado oficial (`te`) — e os campos já existentes em 2022.

### Situações especiais verificadas

| Situação | Como aparece | Tratamento |
|---|---|---|
| Seção agregada | `nsp` no `cs.json`; aux.json inexistente (404) | `skipped` / `ST_AGREGADA=true`, votos estão no BU da principal (`nsa`) |
| Urna de contingência | `tipoUrna = reservaSecao` (10 seções no AC) | preservado em `TP_URNA` |
| Sistema de Apuração | arquivo `busa`, `dadosSA`, `tipoArquivo = saManual`, motivo | `TP_ORIGEM_BU`, `TP_ARQUIVO`, `DS_MOTIVO_SA`, junta/turma |
| BU reenviado | mais de um hash no aux.json | escolhe o `Totalizado` mais recente; `QT_HASHES` |
| Sem BU totalizado / não instalada | aux sem hash `Totalizado` | `skipped` com motivo, reavaliada em toda execução |
| Nulo técnico | votável no BU ausente do resultado oficial (ex.: candidatura indeferida) | `DS_DESTINACAO_VOTO` nulo; validado contra `vnt` |
| Anulado sub judice | `dvt = "Anulado sub judice"` (candidato e/ou legenda) | preservado; legenda comparada com `tval` |

## 5. Schema do Parquet

Ver a seção *Schema* do [README](../README.md#schema) e [`schemas.py`](../src/tse2026/schemas.py).
