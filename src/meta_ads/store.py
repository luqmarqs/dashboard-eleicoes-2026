"""Armazenamento local (SQLite) da coleta da Biblioteca de Anúncios.

Tabelas:
    vinculos          página da Meta <-> candidatura (natureza, evidência, status de revisão)
    anuncios          estado mais recente de cada anúncio (1 linha por ad_id)
    observacoes       histórico: uma linha por coleta em que o anúncio mudou (métricas + JSON saneado, gzip)
    localidades       segmentação (target_locations) do estado mais recente, uma linha por localidade
    entrega_regional  delivery_by_region do estado mais recente (proporção do alcance por região)
    execucoes         cada rodada: período, páginas, contagens, erros saneados, versão da API
    checkpoints       cursor por (execução, página) para retomar coletas interrompidas

IDs da Meta são TEXT (passam de 2^53). Faixas: *_min/*_max; teto ausente fica NULL (faixa aberta), nunca 0.
Datas: ISO-8601; a API devolve só a data (AAAA-MM-DD) para criação e veiculação; coleta em UTC com fuso.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .client import sanear_obj
from .geo import CadastroIbge, interpretar

SCHEMA = """
CREATE TABLE IF NOT EXISTS vinculos (
  page_id TEXT NOT NULL, page_name TEXT, uf TEXT NOT NULL, candidatura_id INTEGER NOT NULL,
  cd_cargo INTEGER, numero INTEGER, nm_urna TEXT,
  natureza TEXT NOT NULL CHECK (natureza IN ('oficial','partido','apoiador','nao_confirmado')),
  evidencia TEXT, status_revisao TEXT NOT NULL CHECK (status_revisao IN ('confirmado','a_revisar','rejeitado')),
  coletar INTEGER NOT NULL DEFAULT 0,  -- confirmado, ou incluído na revisão manual mesmo sem confirmação
  PRIMARY KEY (page_id, candidatura_id)
);
CREATE TABLE IF NOT EXISTS anuncios (
  ad_id TEXT PRIMARY KEY, page_id TEXT NOT NULL, page_name TEXT, bylines TEXT,
  criado_em TEXT, inicio_veiculacao TEXT, fim_veiculacao TEXT,
  textos TEXT, titulos_link TEXT, descricoes_link TEXT, legendas_link TEXT, plataformas TEXT, idiomas TEXT,
  moeda TEXT, gasto_min REAL, gasto_max REAL, impressoes_min REAL, impressoes_max REAL,
  alcance_br INTEGER, publico_estimado_min REAL, publico_estimado_max REAL,
  idades_alvo TEXT, genero_alvo TEXT, link_biblioteca TEXT,
  primeira_coleta TEXT NOT NULL, ultima_coleta TEXT NOT NULL, ultima_execucao TEXT, hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS anuncios_page ON anuncios(page_id);
CREATE TABLE IF NOT EXISTS observacoes (
  ad_id TEXT NOT NULL, coletado_em TEXT NOT NULL, execucao_id TEXT NOT NULL, versao_api TEXT NOT NULL,
  hash TEXT NOT NULL, gasto_min REAL, gasto_max REAL, impressoes_min REAL, impressoes_max REAL,
  alcance_br INTEGER, bruto_gz BLOB NOT NULL,
  PRIMARY KEY (ad_id, execucao_id)
);
CREATE TABLE IF NOT EXISTS localidades (
  ad_id TEXT NOT NULL, ordem INTEGER NOT NULL, nome_original TEXT NOT NULL, tipo TEXT, excluida INTEGER NOT NULL,
  num_obfuscated INTEGER, nivel TEXT NOT NULL, uf TEXT, municipio_nome TEXT, cd_ibge INTEGER, bairro_nome TEXT,
  cep_prefixo TEXT, status TEXT NOT NULL, metodo TEXT,
  PRIMARY KEY (ad_id, ordem)
);
CREATE INDEX IF NOT EXISTS localidades_ibge ON localidades(cd_ibge);
CREATE TABLE IF NOT EXISTS entrega_regional (
  ad_id TEXT NOT NULL, regiao TEXT NOT NULL, uf TEXT, proporcao REAL,
  PRIMARY KEY (ad_id, regiao)
);
CREATE TABLE IF NOT EXISTS execucoes (
  id TEXT PRIMARY KEY, modo TEXT NOT NULL, iniciada_em TEXT NOT NULL, terminada_em TEXT, status TEXT NOT NULL,
  versao_api TEXT NOT NULL, periodo_min TEXT, periodo_max TEXT, paginas_alvo INTEGER, paginas_concluidas INTEGER,
  paginas_com_falha INTEGER, anuncios_vistos INTEGER DEFAULT 0, anuncios_novos INTEGER DEFAULT 0,
  observacoes_novas INTEGER DEFAULT 0, erros TEXT
);
CREATE TABLE IF NOT EXISTS checkpoints (
  execucao_id TEXT NOT NULL, page_id TEXT NOT NULL, cursor_after TEXT, concluida INTEGER NOT NULL DEFAULT 0,
  anuncios INTEGER NOT NULL DEFAULT 0, erro TEXT, atualizado_em TEXT,
  PRIMARY KEY (execucao_id, page_id)
);
"""


def agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _faixa(v: Any) -> tuple[float | None, float | None]:
    """InsightsRangeValue -> (min, max); teto ausente = None (aberto); campo ausente = (None, None)."""
    if not isinstance(v, dict):
        return None, None
    lo, hi = v.get("lower_bound"), v.get("upper_bound")
    return (float(lo) if lo not in (None, "") else None, float(hi) if hi not in (None, "") else None)


def _j(v: Any) -> str | None:
    return json.dumps(v, ensure_ascii=False) if v not in (None, [], "") else None


def hash_anuncio(ad: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(ad, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


class Banco:
    def __init__(self, caminho: Path, ibge: CadastroIbge | None = None):
        caminho.parent.mkdir(parents=True, exist_ok=True)
        self.con = sqlite3.connect(caminho, check_same_thread=False, timeout=120)  # escrita serializada pela coleta
        self.con.execute("PRAGMA journal_mode=WAL")  # leitura (análises, exportação) não bloqueia a coleta
        self.con.row_factory = sqlite3.Row
        self.con.executescript(SCHEMA)
        self.ibge = ibge

    def close(self) -> None:
        self.con.close()

    # ---- vínculos ----
    def gravar_vinculos(self, linhas: Iterable[dict[str, Any]]) -> None:
        with self.con:
            for r in linhas:
                self.con.execute(
                    """INSERT INTO vinculos VALUES (:page_id,:page_name,:uf,:candidatura_id,:cd_cargo,:numero,:nm_urna,
                       :natureza,:evidencia,:status_revisao,:coletar)
                       ON CONFLICT (page_id, candidatura_id) DO UPDATE SET page_name=excluded.page_name,
                       natureza=excluded.natureza, evidencia=excluded.evidencia, status_revisao=excluded.status_revisao,
                       coletar=excluded.coletar""",
                    {**r, "coletar": int(r.get("coletar") or r["status_revisao"] == "confirmado")})

    def paginas_para_coletar(self) -> list[str]:
        """Páginas com vínculo confirmado, ou incluídas na revisão manual (marcadas como não confirmadas)."""
        return [r[0] for r in self.con.execute(
            "SELECT DISTINCT page_id FROM vinculos WHERE coletar = 1 AND status_revisao <> 'rejeitado' ORDER BY page_id")]

    # ---- execuções e checkpoints ----
    def abrir_execucao(self, eid: str, modo: str, versao: str, pmin: str | None, pmax: str | None, alvo: int) -> None:
        with self.con:
            self.con.execute(
                """INSERT INTO execucoes (id, modo, iniciada_em, status, versao_api, periodo_min, periodo_max, paginas_alvo)
                   VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET status='em_andamento'""",
                (eid, modo, agora(), "em_andamento", versao, pmin, pmax, alvo))

    def checkpoint(self, eid: str, page_id: str) -> sqlite3.Row | None:
        return self.con.execute("SELECT * FROM checkpoints WHERE execucao_id=? AND page_id=?", (eid, page_id)).fetchone()

    def salvar_checkpoint(self, eid: str, page_id: str, after: str | None, concluida: bool, n: int,
                          erro: str | None = None) -> None:
        with self.con:
            self.con.execute(
                """INSERT INTO checkpoints VALUES (?,?,?,?,?,?,?) ON CONFLICT (execucao_id, page_id) DO UPDATE SET
                   cursor_after=excluded.cursor_after, concluida=excluded.concluida,
                   anuncios=checkpoints.anuncios + excluded.anuncios, erro=excluded.erro, atualizado_em=excluded.atualizado_em""",
                (eid, page_id, after, int(concluida), n, erro, agora()))

    def fechar_execucao(self, eid: str, erros: list[str]) -> str:
        c = self.con.execute(
            """SELECT COUNT(*) alvo, SUM(concluida) ok, SUM(erro IS NOT NULL AND concluida = 0) falha
               FROM checkpoints WHERE execucao_id = ?""", (eid,)).fetchone()
        alvo = self.con.execute("SELECT paginas_alvo FROM execucoes WHERE id=?", (eid,)).fetchone()[0]
        ok = c["ok"] or 0
        status = "completa" if ok == alvo and not erros else ("parcial" if ok else "falhou")
        with self.con:
            self.con.execute(
                """UPDATE execucoes SET terminada_em=?, status=?, paginas_concluidas=?, paginas_com_falha=?, erros=?
                   WHERE id=?""", (agora(), status, ok, alvo - ok, _j(erros), eid))
        return status

    # ---- anúncios ----
    def gravar_anuncio(self, ad: dict[str, Any], eid: str, versao: str, token: str | None = None) -> tuple[bool, bool]:
        """Upsert idempotente. Devolve (novo, mudou). Observação histórica só quando o conteúdo muda."""
        ad = sanear_obj(ad, token)
        ad_id = str(ad["id"])
        h = hash_anuncio(ad)
        ts = agora()
        antigo = self.con.execute("SELECT hash FROM anuncios WHERE ad_id=?", (ad_id,)).fetchone()
        gmin, gmax = _faixa(ad.get("spend"))
        imin, imax = _faixa(ad.get("impressions"))
        pmin, pmax = _faixa(ad.get("estimated_audience_size"))
        reach = ad.get("br_total_reach")
        reach = int(reach) if reach not in (None, "") else None
        with self.con:
            self.con.execute(
                """INSERT INTO anuncios VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT (ad_id) DO UPDATE SET page_id=excluded.page_id, page_name=excluded.page_name,
                   bylines=excluded.bylines, criado_em=excluded.criado_em, inicio_veiculacao=excluded.inicio_veiculacao,
                   fim_veiculacao=excluded.fim_veiculacao, textos=excluded.textos, titulos_link=excluded.titulos_link,
                   descricoes_link=excluded.descricoes_link, legendas_link=excluded.legendas_link,
                   plataformas=excluded.plataformas, idiomas=excluded.idiomas, moeda=excluded.moeda,
                   gasto_min=excluded.gasto_min, gasto_max=excluded.gasto_max, impressoes_min=excluded.impressoes_min,
                   impressoes_max=excluded.impressoes_max, alcance_br=excluded.alcance_br,
                   publico_estimado_min=excluded.publico_estimado_min, publico_estimado_max=excluded.publico_estimado_max,
                   idades_alvo=excluded.idades_alvo, genero_alvo=excluded.genero_alvo,
                   ultima_coleta=excluded.ultima_coleta, ultima_execucao=excluded.ultima_execucao, hash=excluded.hash""",
                (ad_id, str(ad.get("page_id") or ""), ad.get("page_name"), ad.get("bylines"),
                 ad.get("ad_creation_time"), ad.get("ad_delivery_start_time"), ad.get("ad_delivery_stop_time"),
                 _j(ad.get("ad_creative_bodies")), _j(ad.get("ad_creative_link_titles")),
                 _j(ad.get("ad_creative_link_descriptions")), _j(ad.get("ad_creative_link_captions")),
                 _j(ad.get("publisher_platforms")), _j(ad.get("languages")), ad.get("currency"),
                 gmin, gmax, imin, imax, reach, pmin, pmax, _j(ad.get("target_ages")), ad.get("target_gender"),
                 f"https://www.facebook.com/ads/library/?id={ad_id}", ts, ts, eid, h))
            mudou = antigo is None or antigo["hash"] != h
            if mudou:
                self.con.execute(
                    "INSERT OR IGNORE INTO observacoes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (ad_id, ts, eid, versao, h, gmin, gmax, imin, imax, reach,
                     gzip.compress(json.dumps(ad, ensure_ascii=False).encode())))
                self.con.execute("DELETE FROM localidades WHERE ad_id=?", (ad_id,))
                for i, loc in enumerate(ad.get("target_locations") or []):
                    L = interpretar(loc, self.ibge)
                    self.con.execute(
                        "INSERT INTO localidades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (ad_id, i, L.nome_original, L.tipo, int(L.excluida), L.num_obfuscated, L.nivel, L.uf,
                         L.municipio_nome, L.cd_ibge, L.bairro_nome, L.cep_prefixo, L.status, L.metodo))
                self.con.execute("DELETE FROM entrega_regional WHERE ad_id=?", (ad_id,))
                from .geo import uf_de_regiao
                for d in ad.get("delivery_by_region") or []:
                    p = d.get("percentage")
                    self.con.execute("INSERT OR REPLACE INTO entrega_regional VALUES (?,?,?,?)",
                                     (ad_id, d.get("region"), uf_de_regiao(d.get("region")),
                                      float(p) if p not in (None, "") else None))
        return antigo is None, mudou

    def contar(self, eid: str, vistos: int, novos: int, obs: int) -> None:
        with self.con:
            self.con.execute(
                """UPDATE execucoes SET anuncios_vistos = anuncios_vistos + ?, anuncios_novos = anuncios_novos + ?,
                   observacoes_novas = observacoes_novas + ? WHERE id = ?""", (vistos, novos, obs, eid))
