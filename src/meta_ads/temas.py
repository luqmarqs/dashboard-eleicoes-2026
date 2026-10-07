"""Temas dos criativos por candidatura, com a MESMA taxonomia do painel (lida de dashboard/src/lib/temas.ts).

Unidade: criativo distinto (página + texto normalizado, sem rodapés legais). Grava em meta_temas_cand (Supabase) e no
dev-data. Usado para comparar blocos (aba Apocalipse) sem baixar todos os anúncios no navegador.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

from .store import Banco

RODAPES = [r"propaganda eleitoral[^.!?\n]*", r"cnpj[^.!?\n]*", r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}[^.!?\n]*",
           r"federacao [^.!?\n]*", r"\bfe (?:brasil|psol)[^.!?\n]*", r"coligacao [^.!?\n]*", r"pago por [^.!?\n]*"]


def carregar_taxonomia(root: Path) -> list[tuple[str, re.Pattern]]:
    ts = (root / "dashboard" / "src" / "lib" / "temas.ts").read_text(encoding="utf-8")
    out = []
    for m in re.finditer(r'\{ id: "(\w+)", rotulo: "[^"]+"(?:, rotuloEn: "[^"]*")?, termos: \[([^\]]*)\]', ts):
        termos = re.findall(r'"([^"]*)"', m[2])
        alt = "|".join(re.escape(t.strip()) + (r"(?![a-z0-9])" if t.endswith(" ") else "") for t in termos)
        out.append((m[1], re.compile(rf"(?:^|[^a-z0-9])(?:{alt})")))
    if not out:
        raise SystemExit("taxonomia de temas não encontrada em temas.ts")
    return out


def normalizar(textos: list[str]) -> str:
    s = unicodedata.normalize("NFKD", " \n ".join(textos)).encode("ascii", "ignore").decode().lower().replace("@", "")
    for r in RODAPES:
        s = re.sub(r, " ", s)
    return " " + re.sub(r"\s+", " ", s) + " "


def temas_por_candidatura(b: Banco, root: Path) -> list[tuple[int, str, int, int, int]]:
    tax = carregar_taxonomia(root)
    paginas = defaultdict(set)
    for cid, pid in b.con.execute("SELECT candidatura_id, page_id FROM vinculos WHERE status_revisao <> 'rejeitado'"):
        paginas[cid].add(pid)
    linhas = []
    for cid, pids in paginas.items():
        ph = ",".join("?" * len(pids))
        criativos: dict[str, set[str]] = {}
        anuncios = defaultdict(int)
        for pid, textos, titulos in b.con.execute(f"SELECT page_id, textos, titulos_link FROM anuncios WHERE page_id IN ({ph})", tuple(pids)):
            t = normalizar((json.loads(textos) if textos else []) + (json.loads(titulos) if titulos else []))
            if len(t.strip()) < 3:
                continue
            k = f"{pid}|{t}"
            if k not in criativos:
                criativos[k] = {tid for tid, rx in tax if rx.search(t)}
            for tid in criativos[k]:
                anuncios[tid] += 1
        total = len(criativos)
        cont = defaultdict(int)
        for ts in criativos.values():
            for tid in ts:
                cont[tid] += 1
        for tid, n in cont.items():
            linhas.append((cid, tid, n, anuncios[tid], total))
    return linhas
