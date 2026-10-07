"""Descoberta de páginas e coleta de anúncios.

Descoberta (por candidatura alvo):
    busca `search_terms` = nome de urna (frase exata) em anúncios políticos veiculados no Brasil desde o início
    da campanha; para cada página encontrada, o vínculo só é CONFIRMADO quando o financiador declarado
    (`bylines`) traz o nome completo da candidatura no TSE junto com "2026" — o formato do CNPJ de campanha
    ("ELEICAO 2026 <NOME COMPLETO> <CARGO>"). Página com o nome de urna no nome da página, sem esse
    financiador, vira vínculo "a_revisar" (nunca coletado sem revisão humana). Semelhança de nome sozinha
    não confirma nada.

Coleta (por página confirmada): `search_page_ids`, paginação completa por cursor, checkpoint por página,
upsert idempotente por ad_id, observação histórica quando o anúncio muda.
"""

from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterable

from .client import Cliente, MetaErro, PermissaoInsuficiente, TokenInvalido, sanear
from .geo import norm
from .store import Banco, agora

INICIO_CAMPANHA = "2026-08-16"  # propaganda eleitoral permitida a partir de 16/08 (Lei 9.504, art. 36)
CAMPOS = ",".join([
    "id", "page_id", "page_name", "bylines", "ad_creation_time", "ad_delivery_start_time", "ad_delivery_stop_time",
    "ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_descriptions", "ad_creative_link_captions",
    "publisher_platforms", "languages", "currency", "spend", "impressions", "br_total_reach",
    "estimated_audience_size", "delivery_by_region", "demographic_distribution", "target_ages", "target_gender",
    "target_locations", "total_reach_by_location",
])
BASE_PARAMS = {"ad_type": "POLITICAL_AND_ISSUE_ADS", "ad_reached_countries": ["BR"], "ad_active_status": "ALL"}


@dataclass
class Alvo:
    uf: str
    candidatura_id: int
    cd_cargo: int
    numero: int
    nm_urna: str
    nm_candidato: str
    situacao: str


def alvos(dir_dashboard: Path, ufs: Iterable[str], extras: Iterable[tuple[str, int, int]] = ()) -> list[Alvo]:
    """Candidaturas eleitas (situação 'Eleito…') das UFs + extras (uf, cargo, número)."""
    extras = set(extras)
    out = []
    for uf in ufs:
        for r in csv.DictReader((dir_dashboard / uf.lower() / "candidaturas.csv").open(encoding="utf-8")):
            if r["tipo"] != "nominal":
                continue
            chave = (uf.upper(), int(r["cd_cargo"]), int(r["numero"]))
            if (r["situacao"] or "").startswith("Eleito") or chave in extras:
                out.append(Alvo(uf.upper(), int(r["id"]), int(r["cd_cargo"]), int(r["numero"]), r["nm_urna"],
                                r["nm_candidato"], r["situacao"] or ""))
    return out


def financiador_confere(nm_candidato: str, byline: str | None) -> bool:
    """O financiador declarado é o CNPJ de campanha desta pessoa: "... 2026 <NOME COMPLETO> <cargo|CNPJ|fim>".

    Exige o nome completo inteiro logo após "2026" e seguido de cargo, CNPJ, número ou fim — evita que
    "ANA PAULA SILVA" confira com "ELEICAO 2026 ANA PAULA SILVA SOUZA" (outra pessoa).
    """
    import re
    nome, nb = norm(nm_candidato), norm(byline)
    if not nome or "2026" not in nb:
        return False
    padrao = rf"(?:^| )2026 {re.escape(nome)}(?: (?:DEPUTAD|SENADOR|GOVERNADOR|VICE|PRESIDENTE|CNPJ|N |\d)|$)"
    return re.search(padrao, nb) is not None


def classificar_pagina(alvo: Alvo, page_name: str | None, bylines: Counter) -> tuple[str, str, str] | None:
    """(natureza, status_revisao, evidência) para uma página encontrada na busca, ou None se não tem relação."""
    nome = norm(alvo.nm_candidato)
    for b, n in bylines.most_common():
        if financiador_confere(alvo.nm_candidato, b):
            return "oficial", "confirmado", f"financiador declarado '{b}' contém o nome completo no TSE ({n} anúncios na busca)"
    urna = norm(alvo.nm_urna)
    if urna and urna in norm(page_name):
        ex = bylines.most_common(1)[0][0] if bylines else "(sem financiador)"
        return "nao_confirmado", "a_revisar", f"nome de urna no nome da página; financiador '{ex}' não é o CNPJ de campanha"
    return None


def descobrir(cli: Cliente, lista: list[Alvo], saida: Path, max_paginas_api: int = 4,
              log=print) -> list[dict[str, Any]]:
    """Busca páginas de cada alvo; grava CSV de evidências. Não grava nada no banco (revisão vem antes)."""
    linhas: list[dict[str, Any]] = []
    saida.parent.mkdir(parents=True, exist_ok=True)
    feitos: set[int] = set()
    if saida.exists():  # retoma
        for r in csv.DictReader(saida.open(encoding="utf-8")):
            linhas.append(r)
            feitos.add(int(r["candidatura_id"]))
    campos = ["uf", "candidatura_id", "cd_cargo", "numero", "nm_urna", "nm_candidato", "situacao", "page_id",
              "page_name", "natureza", "status_revisao", "evidencia", "anuncios_na_busca", "busca_completa"]
    novo = not saida.exists()
    with saida.open("a", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=campos)
        if novo:
            w.writeheader()
        for i, a in enumerate(lista):
            if a.candidatura_id in feitos:
                continue
            por_pagina: dict[str, Counter] = defaultdict(Counter)
            nomes: dict[str, str] = {}
            completa = True
            params = dict(BASE_PARAMS, search_terms=a.nm_urna[:100], search_type="KEYWORD_EXACT_PHRASE",
                          ad_delivery_date_min=INICIO_CAMPANHA, fields="page_id,page_name,bylines")
            try:
                for dados, after in cli.paginar(params, limit=500, max_paginas=max_paginas_api):
                    for ad in dados:
                        pid = str(ad.get("page_id") or "")
                        por_pagina[pid][ad.get("bylines") or ""] += 1
                        nomes[pid] = ad.get("page_name") or ""
                    completa = after is None
            except (TokenInvalido, PermissaoInsuficiente):
                raise
            except MetaErro as e:
                log(f"  {a.nm_urna}: erro na busca ({sanear(e)}); fica para a próxima rodada")
                continue
            achou = False
            for pid, byl in por_pagina.items():
                c = classificar_pagina(a, nomes.get(pid), byl)
                if not c:
                    continue
                achou = True
                linha = dict(uf=a.uf, candidatura_id=a.candidatura_id, cd_cargo=a.cd_cargo, numero=a.numero,
                             nm_urna=a.nm_urna, nm_candidato=a.nm_candidato, situacao=a.situacao, page_id=pid,
                             page_name=nomes.get(pid), natureza=c[0], status_revisao=c[1], evidencia=c[2],
                             anuncios_na_busca=sum(byl.values()), busca_completa=int(completa))
                w.writerow(linha)
                linhas.append(linha)
            if not achou:
                linha = dict(uf=a.uf, candidatura_id=a.candidatura_id, cd_cargo=a.cd_cargo, numero=a.numero,
                             nm_urna=a.nm_urna, nm_candidato=a.nm_candidato, situacao=a.situacao, page_id="",
                             page_name="", natureza="", status_revisao="nao_encontrada",
                             evidencia="nenhuma página com financiador ou nome compatível na busca pelo nome de urna",
                             anuncios_na_busca=0, busca_completa=int(completa))
                w.writerow(linha)
                linhas.append(linha)
            fh.flush()
            if (i + 1) % 20 == 0:
                log(f"  descoberta: {i + 1}/{len(lista)} (uso da API {cli.uso.pct:.0f}%)")
    return linhas


def descobrir_no_relatorio(zip_path: Path, lista: list[Alvo]) -> list[dict[str, Any]]:
    """Páginas a partir da lista de anunciantes do relatório da Biblioteca de Anúncios (CSV oficial baixado no site).

    O relatório só serve para DESCOBRIR page_ids: o vínculo é confirmado pelo mesmo critério (financiador
    declarado com o nome completo do TSE + "2026"); os anúncios e métricas vêm sempre da API.
    """
    import io
    import zipfile
    z = zipfile.ZipFile(zip_path)
    nome = next(n for n in z.namelist() if n.endswith("_advertisers.csv"))
    por_nome: dict[str, list[tuple[str, str, str, str]]] = defaultdict(list)
    with z.open(nome) as fh:
        for r in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            disc = r.get("Disclaimer") or ""
            if "2026" in disc:
                por_nome["*"].append((r["Page ID"], r["Page name"], disc, r.get("Amount spent (BRL)") or ""))
    anunciantes = [(pid, pn, d, norm(d), g) for pid, pn, d, g in por_nome["*"]]
    out = []
    for a in lista:
        alvo = norm(a.nm_candidato)
        if not alvo:
            continue
        for pid, pn, d, nd, g in anunciantes:
            # nome completo como sequência de palavras inteiras dentro do financiador declarado
            if financiador_confere(a.nm_candidato, d):
                out.append(dict(uf=a.uf, candidatura_id=a.candidatura_id, cd_cargo=a.cd_cargo, numero=a.numero,
                                nm_urna=a.nm_urna, nm_candidato=a.nm_candidato, situacao=a.situacao, page_id=pid,
                                page_name=pn, natureza="oficial", status_revisao="confirmado",
                                evidencia=f"relatório da Biblioteca de Anúncios ({zip_path.stem}): financiador declarado '{d}' "
                                          f"contém o nome completo no TSE",
                                anuncios_na_busca="", busca_completa=""))
    return out


def coletar(cli: Cliente, banco: Banco, paginas: list[str], execucao_id: str, modo: str,
            periodo_min: str | None, periodo_max: str | None = None, log=print, workers: int = 6) -> str:
    """Coleta todas as páginas (várias em paralelo); retomável pelo mesmo execucao_id. Devolve o status da execução.

    As chamadas à API correm em paralelo; toda escrita no banco passa por uma trava (SQLite tem um só escritor).
    """
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed

    trava = threading.Lock()
    banco.abrir_execucao(execucao_id, modo, cli.versao, periodo_min, periodo_max, len(paginas))
    erros: list[str] = []
    parar = threading.Event()

    def processar(pid: str) -> None:
        with trava:
            cp = banco.checkpoint(execucao_id, pid)
        if cp and cp["concluida"]:
            return
        after = cp["cursor_after"] if cp else None
        params = dict(BASE_PARAMS, search_page_ids=[pid], fields=CAMPOS)
        if periodo_min:
            params["ad_delivery_date_min"] = periodo_min
        if periodo_max:
            params["ad_delivery_date_max"] = periodo_max
        try:
            for dados, prox in cli.paginar(params, after=after, limit=250):
                if parar.is_set():
                    return
                with trava:
                    novos = obs = 0
                    for ad in dados:
                        n, m = banco.gravar_anuncio(ad, execucao_id, cli.versao, cli.token)
                        novos += n
                        obs += m
                    banco.contar(execucao_id, len(dados), novos, obs)
                    banco.salvar_checkpoint(execucao_id, pid, prox, prox is None, len(dados))
                after = prox
        except TokenInvalido as e:
            parar.set()
            with trava:
                banco.salvar_checkpoint(execucao_id, pid, after, False, 0, sanear(e))
                erros.append(f"{pid}: {sanear(e)}")
            raise
        except MetaErro as e:
            with trava:
                banco.salvar_checkpoint(execucao_id, pid, after, False, 0, sanear(e))
                erros.append(f"{pid}: {sanear(e)}")
            log(f"  página {pid}: {sanear(e)}")

    feitas = 0
    token_invalido: TokenInvalido | None = None
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futuros = [ex.submit(processar, pid) for pid in paginas]
        for f in as_completed(futuros):
            try:
                f.result()
            except TokenInvalido as e:
                token_invalido = e
            feitas += 1
            if feitas % 10 == 0:
                log(f"  coleta: {feitas}/{len(paginas)} páginas (uso da API {cli.uso.pct:.0f}%)")
    status = banco.fechar_execucao(execucao_id, erros)
    if token_invalido:
        raise token_invalido
    return status


def periodo_incremental(banco: Banco, dias_reconsulta: int = 14) -> str:
    """Início da janela incremental: última coleta completa menos `dias_reconsulta` (reconsulta anúncios recentes,
    cujas faixas acumuladas ainda mudam). Sem coleta completa anterior, volta ao início da campanha."""
    r = banco.con.execute(
        "SELECT MAX(iniciada_em) FROM execucoes WHERE status = 'completa'").fetchone()[0]
    if not r:
        return INICIO_CAMPANHA
    d = date.fromisoformat(r[:10]) - timedelta(days=dias_reconsulta)
    return max(d.isoformat(), INICIO_CAMPANHA)


def novo_id_execucao(modo: str) -> str:
    return f"{agora().replace(':', '').replace('-', '')[:15]}_{modo}"
