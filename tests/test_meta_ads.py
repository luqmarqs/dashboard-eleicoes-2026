"""Testes do coletor da Biblioteca de Anúncios (src/meta_ads).

Os anúncios aqui são SINTÉTICOS (fixtures de teste), montados no formato observado nas respostas reais;
servem só para exercitar a lógica e não são evidência de cobertura ou de valores reais.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from meta_ads.client import Cliente, TokenInvalido, PermissaoInsuficiente, sanear, sanear_obj
from meta_ads.coleta import Alvo, classificar_pagina, coletar
from meta_ads.geo import CadastroIbge, interpretar, uf_de_regiao
from meta_ads.store import Banco
from collections import Counter

TOKEN = "EAATESTE123token"

IBGE = CadastroIbge([
    (3509502, "Campinas", "SP"),
    (4314902, "Porto Alegre", "RS"),
    (3106200, "Belo Horizonte", "MG"),
    (3157807, "Santa Luzia", "MG"),
    (2928901, "Santa Luzia", "BA"),          # homônimo em outra UF
    (3170800, "Várzea da Palma", "MG"),
    (3549805, "São José do Rio Preto", "SP"),
])


def anuncio(ad_id: str, **extra) -> dict:
    base = {
        "id": ad_id, "page_id": "999000111222333444", "page_name": "Página Teste", "bylines": "ELEICAO 2026 FULANA DE TAL",
        "ad_delivery_start_time": "2026-09-01", "ad_delivery_stop_time": None, "currency": "BRL",
        "spend": {"lower_bound": "100", "upper_bound": "199"}, "impressions": {"lower_bound": "1000", "upper_bound": "1999"},
        "br_total_reach": 900, "target_locations": [], "delivery_by_region": [],
        "ad_snapshot_url": f"https://www.facebook.com/ads/archive/render_ad/?id={ad_id}&access_token={TOKEN}",
    }
    base.update(extra)
    return base


def cliente_fake(paginas: list[dict], status: int = 200, erro: dict | None = None) -> tuple[Cliente, list]:
    chamadas: list = []

    def handler(req: httpx.Request) -> httpx.Response:
        chamadas.append(dict(req.url.params))
        if erro:
            return httpx.Response(status, json={"error": erro})
        i = 0 if "after" not in req.url.params else int(req.url.params["after"])
        corpo = {"data": paginas[i]}
        if i + 1 < len(paginas):
            corpo["paging"] = {"cursors": {"after": str(i + 1)},
                               "next": f"https://graph.facebook.com/v26.0/ads_archive?access_token={TOKEN}&after={i + 1}"}
        return httpx.Response(200, json=corpo, headers={"x-business-use-case-usage": json.dumps(
            {"1": [{"type": "ads_archive", "call_count": 5, "total_cputime": 1, "total_time": 1,
                    "estimated_time_to_regain_access": 0}]})})

    cli = Cliente(TOKEN, versao="v26.0", http=httpx.Client(transport=httpx.MockTransport(handler)),
                  dormir=lambda s: None, max_tentativas=3)
    return cli, chamadas


@pytest.fixture
def banco(tmp_path: Path) -> Banco:
    b = Banco(tmp_path / "m.sqlite", IBGE)
    yield b
    b.close()


# ---- paginação, deduplicação, idempotência ----

def test_paginacao_completa_e_deduplicacao(banco: Banco) -> None:
    pags = [[anuncio("1"), anuncio("2")], [anuncio("2"), anuncio("3")], [anuncio("4")]]  # "2" repetido entre páginas
    cli, chamadas = cliente_fake(pags)
    st = coletar(cli, banco, ["999000111222333444"], "exec1", "completa", "2026-08-16", log=lambda *_: None)
    assert st == "completa"
    assert len(chamadas) == 3 and chamadas[1]["after"] == "1"
    assert banco.con.execute("SELECT COUNT(*) FROM anuncios").fetchone()[0] == 4
    ex = dict(banco.con.execute("SELECT * FROM execucoes").fetchone())
    assert ex["anuncios_vistos"] == 5 and ex["anuncios_novos"] == 4 and ex["paginas_concluidas"] == 1


def test_reexecucao_idempotente_e_historico(banco: Banco) -> None:
    banco.gravar_anuncio(anuncio("1"), "e1", "v26.0", TOKEN)
    novo, mudou = banco.gravar_anuncio(anuncio("1"), "e2", "v26.0", TOKEN)
    assert (novo, mudou) == (False, False)
    assert banco.con.execute("SELECT COUNT(*) FROM observacoes").fetchone()[0] == 1
    # faixa acumulada sobe: nova observação, a antiga continua
    novo, mudou = banco.gravar_anuncio(anuncio("1", spend={"lower_bound": "200", "upper_bound": "299"}), "e3", "v26.0", TOKEN)
    assert (novo, mudou) == (False, True)
    obs = banco.con.execute("SELECT gasto_min FROM observacoes ORDER BY rowid").fetchall()
    assert [o[0] for o in obs] == [100.0, 200.0]
    assert banco.con.execute("SELECT gasto_min FROM anuncios").fetchone()[0] == 200.0


def test_retomada_pelo_checkpoint(banco: Banco) -> None:
    banco.abrir_execucao("e1", "completa", "v26.0", "2026-08-16", None, 1)
    banco.salvar_checkpoint("e1", "999000111222333444", "1", False, 2)
    pags = [[anuncio("1")], [anuncio("2")]]
    cli, chamadas = cliente_fake(pags)
    coletar(cli, banco, ["999000111222333444"], "e1", "retomada", "2026-08-16", log=lambda *_: None)
    assert chamadas[0].get("after") == "1"  # continuou de onde parou
    assert banco.con.execute("SELECT ad_id FROM anuncios").fetchall()[0][0] == "2"


# ---- campos ausentes e faixas abertas ----

def test_faixa_aberta_e_ausente_nao_viram_zero(banco: Banco) -> None:
    banco.gravar_anuncio(anuncio("1", spend={"lower_bound": "100000"}, impressions=None, br_total_reach=None), "e", "v26.0")
    r = banco.con.execute("SELECT gasto_min, gasto_max, impressoes_min, impressoes_max, alcance_br FROM anuncios").fetchone()
    assert tuple(r) == (100000.0, None, None, None, None)


def test_gasto_zero_e_diferente_de_ausente(banco: Banco) -> None:
    banco.gravar_anuncio(anuncio("1", spend={"lower_bound": "0", "upper_bound": "99"}), "e", "v26.0")
    assert tuple(banco.con.execute("SELECT gasto_min, gasto_max FROM anuncios").fetchone()) == (0.0, 99.0)


# ---- segurança: token nunca guardado ----

def test_token_saneado(banco: Banco) -> None:
    banco.gravar_anuncio(anuncio("1", bylines=f"x access_token={TOKEN}"), "e", "v26.0", TOKEN)
    dump = "\n".join(banco.con.iterdump())
    assert TOKEN not in dump
    import gzip
    bruto = gzip.decompress(banco.con.execute("SELECT bruto_gz FROM observacoes").fetchone()[0]).decode()
    assert TOKEN not in bruto and "ad_snapshot_url" not in bruto
    assert sanear(f"https://x/?a=1&access_token={TOKEN}&b=2") == "https://x/?a=1&access_token=<token>&b=2"
    assert "ad_snapshot_url" not in sanear_obj({"ad_snapshot_url": "u", "x": 1})


def test_erros_classificados_sem_token() -> None:
    cli, _ = cliente_fake([], status=400, erro={"code": 190, "error_subcode": 463,
                                               "message": f"Session has expired access_token={TOKEN}"})
    with pytest.raises(TokenInvalido) as e:
        cli.get({"search_terms": "x"})
    assert TOKEN not in str(e.value)
    cli, _ = cliente_fake([], status=403, erro={"code": 10, "message": "no permission"})
    with pytest.raises(PermissaoInsuficiente):
        cli.get({"search_terms": "x"})


def test_limite_de_uso_tenta_de_novo_e_desiste() -> None:
    cli, chamadas = cliente_fake([], status=400, erro={"code": 613, "message": "rate limit"})
    with pytest.raises(Exception):
        cli.get({"search_terms": "x"})
    assert len(chamadas) == 3  # max_tentativas, sem laço infinito


# ---- localidades: inclusão/exclusão, municípios, homônimos ----

def test_inclusao_e_exclusao(banco: Banco) -> None:
    banco.gravar_anuncio(anuncio("1", target_locations=[
        {"name": "Campinas, SP, Brasil", "type": "CITY", "excluded": False, "num_obfuscated": 0},
        {"name": "São José do Rio Preto, SP, Brasil", "type": "CITY", "excluded": True, "num_obfuscated": 0},
    ]), "e", "v26.0")
    rows = banco.con.execute("SELECT cd_ibge, excluida FROM localidades ORDER BY ordem").fetchall()
    assert [tuple(r) for r in rows] == [(3509502, 0), (3549805, 1)]


def test_municipio_com_brazil_no_meio_e_caixa_diferente() -> None:
    L = interpretar({"name": "Várzea Da Palma, Brazil, MG, Brasil", "type": "CITY", "excluded": False}, IBGE)
    assert (L.nivel, L.uf, L.cd_ibge, L.status) == ("municipio", "MG", 3170800, "validada")


def test_homonimos_respeitam_a_uf() -> None:
    mg = interpretar({"name": "Santa Luzia, MG, Brasil", "type": "CITY", "excluded": False}, IBGE)
    ba = interpretar({"name": "Santa Luzia, BA, Brasil", "type": "CITY", "excluded": False}, IBGE)
    assert mg.cd_ibge == 3157807 and ba.cd_ibge == 2928901
    amb = CadastroIbge([(1, "Xis", "MG"), (2, "Xis", "MG")])
    assert amb.resolver("Xis", "MG") == (None, "ambigua")


def test_bairro_sem_cidade_nao_vira_municipio() -> None:
    # "Santa Luzia, MG" como NEIGHBORHOOD: o nome coincide com um município, mas é um bairro sem cidade informada
    L = interpretar({"name": "Santa Luzia, MG, Brasil", "type": "NEIGHBORHOOD", "excluded": False}, IBGE)
    assert (L.nivel, L.cd_ibge, L.bairro_nome, L.status) == ("bairro", None, "Santa Luzia", "sem_municipio")
    L = interpretar({"name": "Boa Esperança, Belo Horizonte, MG, Brasil", "type": "NEIGHBORHOOD", "excluded": False}, IBGE)
    assert (L.nivel, L.cd_ibge, L.bairro_nome) == ("bairro", 3106200, "Boa Esperança")


def test_uf_cep_pais_e_desconhecida() -> None:
    assert interpretar({"name": "São Paulo (state), Brasil", "type": "regions", "excluded": True}, IBGE).uf == "SP"
    cep = interpretar({"name": "31510, Brasil", "type": "zips", "excluded": False}, IBGE)
    assert (cep.nivel, cep.cep_prefixo, cep.cd_ibge) == ("cep", "31510", None)
    assert interpretar({"name": "Brasil", "type": "countries"}, IBGE).nivel == "pais"
    assert interpretar({"name": "Desconhecida", "type": "Desconhecida"}, IBGE).nivel == "desconhecida"
    assert uf_de_regiao("Rio Grande do Sul") == "RS"


# ---- vínculo página <-> candidatura ----

def test_vinculo_so_confirma_com_financiador_de_campanha() -> None:
    a = Alvo("RS", 1, 7, 50123, "MATHEUS GOMES", "MATHEUS PEREIRA GOMES", "Eleito por QP")
    ok = classificar_pagina(a, "Matheus Gomes 50123", Counter({"ELEICAO 2026 MATHEUS PEREIRA GOMES DEPUTADO ESTADUAL": 10}))
    assert ok[:2] == ("oficial", "confirmado")
    rev = classificar_pagina(a, "Matheus Gomes Fã Clube", Counter({"Fulano": 3}))
    assert rev[:2] == ("nao_confirmado", "a_revisar")
    assert classificar_pagina(a, "Outra Página", Counter({"ELEICAO 2026 OUTRA PESSOA": 2})) is None


def test_financiador_nao_confere_com_nome_mais_longo() -> None:
    from meta_ads.coleta import financiador_confere
    assert financiador_confere("ANA PAULA SILVA", "ELEICAO 2026 ANA PAULA SILVA DEPUTADO ESTADUAL")
    assert financiador_confere("ANA PAULA SILVA", "68.000.000/0001-00 - ELEIÇÃO 2026 Ana Paula Silva")
    assert financiador_confere("MATHEUS PEREIRA GOMES", "ELEICAO 2026 MATHEUS PEREIRA GOMES DEPUTADO ESTADUAL - CNPJ 1")
    assert not financiador_confere("ANA PAULA SILVA", "ELEICAO 2026 ANA PAULA SILVA SOUZA DEPUTADO ESTADUAL")
    assert not financiador_confere("ANA PAULA SILVA", "Ana Paula Silva")  # sem 2026: não é o CNPJ de campanha
    assert not financiador_confere("ANA PAULA SILVA", "ELEICAO 2026 MARIA ANA PAULA SILVA DEPUTADO ESTADUAL")


# ---- dobradas ----

def test_numero_e_nome_em_dobradas() -> None:
    from meta_ads.dobradas import cita_numero, tem_nome, cnpjs, IndicePagador, Cand
    from meta_ads.geo import norm
    t = norm("Vote Zé Nunes 13123 e Manuela 5️⃣0️⃣0️⃣ para o Senado! CNPJ 68.470.009/0001-08")
    assert cita_numero(t, 500) and tem_nome(t, "MANUELA")
    assert not cita_numero(norm("Ganhe R$ 500 hoje"), 500)
    assert not cita_numero(norm("são 500 mil famílias"), 500)
    assert not tem_nome(norm("manutenção da escola"), "MANU")
    assert cnpjs("CNPJ 68.470.009/0001-08 e 68470009000108") == ["68470009000108"]
    idx = IndicePagador([Cand(1, "RS", 7, 13123, "ZÉ NUNES", "JOSE SIDNEY NUNES DE ALMEIDA"),
                         Cand(2, "RS", 5, 500, "MANUELA D'ÁVILA", "MANUELA PINTO VIEIRA D'ÁVILA")])
    assert idx.identificar("ELEICAO 2026 JOSE SIDNEY NUNES DE ALMEIDA DEPUTADO ESTADUAL").id == 1
    assert idx.identificar("Zé Nunes") is None


def test_mencao_exige_coerencia_territorial(banco: Banco) -> None:
    """Anúncio de outro estado com o mesmo nome (ex.: Bancada Feminista do PI) não conta como menção."""
    from meta_ads.dobradas import Cand, analisar
    sp = Cand(2230, "SP", 7, 50000, "PAULA DA BANCADA FEMINISTA", "PAULA NUNES DOS SANTOS")
    pag = Cand(895, "SP", 6, 5005, "GUILHERME CORTEZ", "GUILHERME DA COSTA AGUIAR CORTEZ")
    banco.gravar_anuncio(anuncio("pi", page_name="Bancada Feminista do PSOL - Piauí", bylines="Bancada Feminista do PSOL - Piauí",
                                 ad_creative_bodies=["Vote na Bancada Feminista!"],
                                 target_locations=[{"name": "Piauí, Brasil", "type": "regions", "excluded": False}]), "e", "v26.0")
    banco.gravar_anuncio(anuncio("sp", bylines="ELEICAO 2026 GUILHERME DA COSTA AGUIAR CORTEZ DEPUTADO FEDERAL",
                                 ad_creative_bodies=["Gui 5005 e Bancada Feminista 50000!"],
                                 target_locations=[{"name": "Campinas, SP, Brasil", "type": "CITY", "excluded": False}]), "e", "v26.0")
    analisar(banco, [sp, pag], {2230: ["BANCADA FEMINISTA"]})
    rows = {r[0]: (r[1], r[2]) for r in banco.con.execute("SELECT ad_id, cita_numero, confirmada FROM mencoes WHERE candidatura_id = 2230")}
    assert "pi" not in rows
    assert rows["sp"] == (1, 1)
