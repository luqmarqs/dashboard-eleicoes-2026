"""Gera dashboard/dev-data/<uf>/apocalipse.json (mesmo formato da RPC apocalipse_json) a partir do dev-data da UF.

Uso: python scripts/apocalipse_dev.py SP MG RS
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CARGOS = (1, 3, 5, 6, 7)


def gerar(uf: str) -> None:
    base = ROOT / "dashboard" / "dev-data" / uf.lower()
    loc = json.loads((base / "locais.json").read_text(encoding="utf-8"))
    mun_de = dict(zip(loc["id"], loc["mun"]))
    cand = json.loads((base / "candidaturas.json").read_text(encoding="utf-8"))
    classif_arq = ROOT / "config" / "apocalipse_candidaturas.json"
    classif = {r["chave"]: r for r in json.loads(classif_arq.read_text(encoding="utf-8"))} if classif_arq.exists() else {}
    votos = defaultdict(int)
    cvot = defaultdict(int)
    k_rows = []
    for cid, cargo, num, tipo in zip(cand["id"], cand["cargo"], cand["numero"], cand["tipo"]):
        r = classif.get(f"{uf.upper()}:{cargo}:{num}")
        if r and tipo == "nominal":
            k_rows.append({"id": cid, "cargo": cargo, "numero": num, "nome": r["nome"], "bloco": r["bloco"],
                           "criterio": r["criterio"], "evidencia": r["evidencia"], "fonte": r["fonte"]})
    k_ids = {r["id"] for r in k_rows}
    for cid, cargo, partido in zip(cand["id"], cand["cargo"], cand["partido"]):
        if cargo not in CARGOS:
            continue
        f = base / "votos" / f"{cid}.json"
        if not f.exists():
            continue
        v = json.loads(f.read_text(encoding="utf-8"))
        p = partido or "?"
        for l, q in zip(v["local"], v["votos"]):
            votos[(cargo, mun_de[l], p)] += q
            if cid in k_ids:
                cvot[(cid, mun_de[l])] += q
    validos = defaultdict(int)
    for cargo in CARGOS:
        f = base / "totais" / f"{cargo}.json"
        if not f.exists():
            continue
        t = json.loads(f.read_text(encoding="utf-8"))
        for l, q in zip(t["local"], t["validos"]):
            validos[(cargo, mun_de[l])] += q
    kv = sorted(votos)
    kt = sorted(validos)
    out = {
        "votos": {"cargo": [k[0] for k in kv], "mun": [k[1] for k in kv], "partido": [k[2] for k in kv], "votos": [votos[k] for k in kv]},
        "validos": {"cargo": [k[0] for k in kt], "mun": [k[1] for k in kt], "validos": [validos[k] for k in kt]},
        "classif": sorted(k_rows, key=lambda r: r["id"]),
        "cand": {"id": [k[0] for k in sorted(cvot)], "mun": [k[1] for k in sorted(cvot)], "votos": [cvot[k] for k in sorted(cvot)]},
    }
    (base / "apocalipse.json").write_text(json.dumps(out), encoding="utf-8")
    print(f"{uf}: {len(kv):,} linhas de votos, {len(kt):,} de válidos")


if __name__ == "__main__":
    for uf in sys.argv[1:] or ["SP", "MG", "RS"]:
        gerar(uf)
