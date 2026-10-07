"""Classificação por candidatura (aba Apocalipse): voto na urgência da anistia aos réus do 8 de janeiro.

Fonte: Câmara dos Deputados, dados abertos, votação 2562149-7 (17/09/2025), requerimento de urgência do PL 2162/2023
(311 sim, 163 não). Os votos nominais ficam em data/anistia/votos_urgencia.json; o nome civil de cada deputado vem de
/deputados/{id}. O cruzamento com as candidaturas de 2026 é por nome civil normalizado + UF (deputado federal em
exercício na votação que concorreu em 2026 a qualquer cargo no mesmo estado).

Saída: data/anistia/candidaturas.json  {"UF:cargo:numero": {"voto": "Sim"|"Não"|"Abstenção"|..., "dep": nome parlamentar}}

Uso: python scripts/anistia.py SP MG RS
"""

from __future__ import annotations

import json
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "https://dadosabertos.camara.leg.br/api/v2"
VOTACAO = "2562149-7"


def get(url: str) -> dict:
    for tentativa in range(4):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            time.sleep(1 + tentativa * 2)
    raise SystemExit(f"falha ao baixar {url}")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().upper()
    return " ".join(s.replace("-", " ").split())


def main(ufs: list[str]) -> None:
    arq = ROOT / "data" / "anistia" / "votos_urgencia.json"
    if not arq.exists():
        arq.parent.mkdir(parents=True, exist_ok=True)
        arq.write_text(json.dumps(get(f"{API}/votacoes/{VOTACAO}/votos"), ensure_ascii=False), encoding="utf-8")
    votos = json.loads(arq.read_text(encoding="utf-8"))["dados"]
    cache_arq = ROOT / "data" / "anistia" / "deputados.json"
    cache = json.loads(cache_arq.read_text(encoding="utf-8")) if cache_arq.exists() else {}
    saida: dict[str, dict] = {}
    for uf in ufs:
        cand = json.loads((ROOT / "dashboard" / "dev-data" / uf.lower() / "candidaturas.json").read_text(encoding="utf-8"))
        por_nome: dict[str, list[int]] = {}
        por_urna: dict[str, list[int]] = {}
        for i, (tipo, nc, nu) in enumerate(zip(cand["tipo"], cand["nomeCompleto"], cand["nome"])):
            if tipo == "nominal" and nc:
                por_nome.setdefault(norm(nc), []).append(i)
                por_urna.setdefault(norm(nu), []).append(i)
        achados = 0
        deps = [v for v in votos if v["deputado_"]["siglaUf"] == uf]
        for v in deps:
            d = v["deputado_"]
            sid = str(d["id"])
            if sid not in cache:
                cache[sid] = get(f"{API}/deputados/{sid}")["dados"]["nomeCivil"]
            nc = norm(cache[sid])
            # 1) nome civil igual; 2) nome de urna igual ao nome parlamentar (nome social); 3) nome civil do TSE estende o
            # da Câmara (sobrenome acrescentado), desde que seja um só candidato
            idx = por_nome.get(nc) or por_urna.get(norm(d["nome"])) or []
            if not idx:
                ext = [i for k, ii in por_nome.items() if k.startswith(nc + " ") for i in ii]
                idx = ext if len(ext) == 1 else []
            for i in idx:
                saida[f"{uf}:{cand['cargo'][i]}:{cand['numero'][i]}"] = {"voto": v["tipoVoto"], "dep": d["nome"], "partido2025": d["siglaPartido"]}
            achados += bool(idx)
        print(f"{uf}: {len(deps)} deputados na votação, {achados} concorreram em 2026")
    cache_arq.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")
    out = ROOT / "data" / "anistia" / "candidaturas.json"
    out.write_text(json.dumps(dict(sorted(saida.items())), ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(saida)} candidaturas com voto registrado -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["SP", "MG", "RS"])
