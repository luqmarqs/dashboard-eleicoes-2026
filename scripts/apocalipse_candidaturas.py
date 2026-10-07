"""Classificação por candidatura da aba Apocalipse (por cima do padrão do partido).

Junta duas fontes em config/apocalipse_candidaturas.json:
  1. voto "Sim" na urgência da anistia aos réus do 8 de janeiro (data/anistia/candidaturas.json, de scripts/anistia.py)
     -> extrema direita, para quem é de partido que não está no bloco da extrema direita;
  2. curadoria com fonte pública (config/apocalipse_curadoria_<UF>.json; só as linhas "extrema" mudam algo), que prevalece sobre o item 1.
Depois grava em apocalipse_cand (Supabase), refaz o cache do Apocalipse e o JSON do dev.

Uso: python scripts/apocalipse_candidaturas.py [--supabase] [SP MG RS]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

EXTREMA_PARTIDO = {"PL", "NOVO", "MISSÃO", "DC"}
ESQUERDA_PARTIDO = {"PT", "PSOL", "PCDOB", "PV", "REDE", "PSB", "PDT", "UP", "PCB", "PSTU", "PCO"}
URL_API = "https://dadosabertos.camara.leg.br/api/v2/votacoes/2562149-7/votos"


def montar(ufs: list[str]) -> list[dict]:
    anistia = json.loads((ROOT / "data" / "anistia" / "candidaturas.json").read_text(encoding="utf-8"))
    curadoria = [x for f in sorted((ROOT / "config").glob("apocalipse_curadoria_*.json"))
                 for x in json.loads(f.read_text(encoding="utf-8"))]
    cand = {}
    for uf in ufs:
        c = json.loads((ROOT / "dashboard" / "dev-data" / uf.lower() / "candidaturas.json").read_text(encoding="utf-8"))
        for i in range(len(c["id"])):
            if c["tipo"][i] == "nominal":
                cand[f"{uf}:{c['cargo'][i]}:{c['numero'][i]}"] = (c["nome"][i], (c["partido"][i] or "").upper())
    out: dict[str, dict] = {}
    for k, v in anistia.items():
        if k not in cand or k.split(":")[0] not in ufs or v["voto"] != "Sim":
            continue
        nome, partido = cand[k]
        if partido in EXTREMA_PARTIDO or partido in ESQUERDA_PARTIDO:
            continue
        out[k] = {"chave": k, "nome": nome, "bloco": "extrema", "criterio": "anistia",
                  "evidencia": f"Como dep. federal ({v['dep']}, {v['partido2025']}), votou Sim na urgência da anistia aos réus do 8 de janeiro (17/09/2025).",
                  "fonte": URL_API}
    for x in curadoria:
        k = x["chave"]
        if k not in cand or k.split(":")[0] not in ufs:
            continue
        if x["bloco"] == "extrema":
            out[k] = {"chave": k, "nome": cand[k][0], "bloco": "extrema", "criterio": f"curadoria-{x.get('criterio') or '?'}",
                      "evidencia": x["evidencia"], "fonte": x.get("fonte")}
    lista = sorted(out.values(), key=lambda r: r["chave"])
    (ROOT / "config" / "apocalipse_candidaturas.json").write_text(json.dumps(lista, ensure_ascii=False, indent=1), encoding="utf-8")
    for uf in ufs:
        print(f"{uf}: {sum(1 for r in lista if r['chave'].startswith(uf))} candidaturas reclassificadas "
              f"({sum(1 for r in lista if r['chave'].startswith(uf) and r['criterio'] == 'anistia')} pela anistia)")
    return lista


def carregar(lista: list[dict], ufs: list[str]) -> None:
    from src.meta_ads.exportar import _inserir, _rodar_sql
    _rodar_sql(ROOT, "delete from public.apocalipse_cand where uf in (" + ",".join(f"'{u}'" for u in ufs) + ");", "limpa apocalipse_cand")
    linhas = []
    for r in lista:
        uf, cargo, num = r["chave"].split(":")
        linhas.append([uf, int(cargo), int(num), r["nome"], r["bloco"], r["criterio"], r["evidencia"], r["fonte"]])
    _inserir(ROOT, "apocalipse_cand", ["uf", "cd_cargo", "numero", "nome", "bloco", "criterio", "evidencia", "fonte"], linhas, None)
    for uf in ufs:
        _rodar_sql(ROOT, f"select public.apocalipse_atualizar('{uf}');", f"apocalipse {uf}")
    print("Supabase: apocalipse_cand e cache atualizados")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ufs = [a.upper() for a in args] or ["SP", "MG", "RS"]
    lista = montar(ufs)
    from apocalipse_dev import gerar
    for uf in ufs:
        gerar(uf)
    if "--supabase" in sys.argv:
        carregar(lista, ufs)
