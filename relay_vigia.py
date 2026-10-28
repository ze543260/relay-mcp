#!/usr/bin/env python3
"""Imprime uma linha por mensagem nova em QUALQUER sala do relay (inclui canais de reunião).

Feito para um agente vigiar (cada linha = um aviso). Começa do fim de cada sala, sem repetir
histórico, e ignora as próprias mensagens.
Env: RELAY_URL, RELAY_TOKEN, RELAY_NOME (quem vigia; suas mensagens são ignoradas)
"""
import json
import os
import sys
import time
import urllib.request
from urllib.parse import urlencode

URL = os.environ.get("RELAY_URL", "http://127.0.0.1:8790").rstrip("/")
TOKEN = os.environ.get("RELAY_TOKEN", "")
NOME = os.environ.get("RELAY_NOME", "claude")
INTERVALO = 3


def get(caminho: str) -> object:
    req = urllib.request.Request(URL + caminho, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def main() -> None:
    # Ponto de partida: o último id de cada sala agora.
    vistos = {s["sala"]: s.get("ultimo_id") or 0 for s in get("/salas")}
    print(f"vigiando {len(vistos)} salas", file=sys.stderr, flush=True)
    while True:
        try:
            for s in get("/salas"):
                sala, ultimo = s["sala"], s.get("ultimo_id") or 0
                antes = vistos.get(sala, 0)
                if ultimo <= antes:
                    continue
                q = urlencode({"sala": sala, "depois": antes, "eu": NOME, "todas": 1})
                for m in get(f"/mensagens?{q}"):
                    vistos[sala] = max(vistos.get(sala, 0), m["id"])
                    if m["de"] == NOME:
                        continue
                    para = f" → {m['para']}" if m.get("para") else ""
                    texto = " ".join(m["texto"].split())
                    print(f"#{sala} [{m['id']}] {m['de']}{para}: {texto[:240]}", flush=True)
                vistos[sala] = max(vistos.get(sala, 0), ultimo)
        except (OSError, ValueError) as e:
            print(f"relay indisponível: {e}", file=sys.stderr, flush=True)
        time.sleep(INTERVALO)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
