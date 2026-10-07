"""Verificação dos vínculos página <-> candidatura pelos criativos e financiadores dos anúncios coletados.

Para cada vínculo: quantos anúncios citam no texto (corpo, título, legenda, descrição) o número de urna e o nome de
urna, e quais financiadores declarados aparecem. Serve para conferir vínculos (sobretudo os "a revisar"); não
confirma nada sozinho: um anúncio de apoiador também pode citar o número.
"""

from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path

from .coleta import financiador_confere
from .geo import norm
from .store import Banco


def _texto(r) -> str:
    partes = []
    for c in ("textos", "titulos_link", "descricoes_link", "legendas_link"):
        if r[c]:
            partes += [str(x) for x in json.loads(r[c]) if x]
    return norm(" ".join(partes))


def verificar(b: Banco, saida: Path, nomes_completos: dict[int, str]) -> list[dict]:
    out = []
    for v in b.con.execute("SELECT * FROM vinculos WHERE coletar = 1 ORDER BY uf, candidatura_id"):
        ads = b.con.execute("SELECT * FROM anuncios WHERE page_id = ?", (v["page_id"],)).fetchall()
        n = len(ads)
        num = str(v["numero"] or "")
        urna = norm(v["nm_urna"])
        re_num = re.compile(rf"(?<!\d){re.escape(num)}(?!\d)") if num else None
        cita_num = cita_nome = 0
        byl = Counter()
        for a in ads:
            t = _texto(a)
            cita_num += bool(re_num and re_num.search(t))
            cita_nome += bool(urna and urna in t)
            byl[a["bylines"] or "(sem financiador)"] += 1
        nome_completo = nomes_completos.get(v["candidatura_id"], "")
        conferem = sum(c for bl, c in byl.items() if financiador_confere(nome_completo, bl))
        out.append(dict(
            uf=v["uf"], candidatura_id=v["candidatura_id"], numero=v["numero"], nm_urna=v["nm_urna"],
            page_id=v["page_id"], page_name=v["page_name"], status_revisao=v["status_revisao"], anuncios=n,
            pct_cita_numero=round(cita_num / n, 3) if n else None, pct_cita_nome=round(cita_nome / n, 3) if n else None,
            pct_financiador_campanha=round(conferem / n, 3) if n else None,
            financiadores=" | ".join(f"{bl} ({c})" for bl, c in byl.most_common(4)),
        ))
    saida.parent.mkdir(parents=True, exist_ok=True)
    with saida.open("w", encoding="utf-8", newline="") as fh:
        if out:
            w = csv.DictWriter(fh, fieldnames=list(out[0]))
            w.writeheader()
            w.writerows(out)
    return out
