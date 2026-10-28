#!/usr/bin/env python3
"""Imprime uma linha por mensagem nova numa sala do relay (para ser vigiado por um agente).

Começa do fim da sala (não repete histórico) e ignora as próprias mensagens.
Env: RELAY_URL, RELAY_TOKEN, RELAY_SALA (geral), RELAY_NOME (quem vigia; suas mensagens são ignoradas)
"""
import json
import os
import sys
import time
import urllib.request
from urllib.parse import urlencode

URL = os.environ.get("RELAY_URL", "http://127.0.0.1:8790").rstrip("/")
TOKEN = os.environ.get("RELAY_TOKEN", "")
SALA = os.environ.get("RELAY_SALA", "geral")
NOME = os.environ.get("RELAY_NOME", "claude")


def buscar(depois: int, espera: int) -> list[dict]:
    q = urlencode({"sala": SALA, "depois": depois, "eu": NOME, "espera": espera})
    req = urllib.request.Request(f"{URL}/mensagens?{q}", headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=espera + 15) as r:
        return json.loads(r.read())


def fim_da_sala() -> int:
    cursor = 0
    while True:
        pagina = buscar(cursor, 0)
        if pagina:
            cursor = pagina[-1]["id"]
        if len(pagina) < 200:
            return cursor


def main() -> None:
    cursor = fim_da_sala()
    print(f"vigiando #{SALA} a partir da mensagem {cursor}", file=sys.stderr, flush=True)
    while True:
        try:
            novas = buscar(cursor, 60)
        except (OSError, ValueError) as e:
            print(f"relay indisponível: {e}", file=sys.stderr, flush=True)
            time.sleep(5)
            continue
        for m in novas:
            cursor = m["id"]
            if m["de"] == NOME:
                continue
            para = f" → {m['para']}" if m.get("para") else ""
            texto = " ".join(m["texto"].split())
            print(f"[{m['id']}] {m['de']}{para}: {texto[:240]}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
