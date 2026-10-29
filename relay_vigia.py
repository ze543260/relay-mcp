#!/usr/bin/env python3
"""Imprime uma linha por mensagem nova em QUALQUER sala do relay (inclui canais de reunião).

Feito para um agente vigiar (cada linha = um aviso). Começa do fim de cada sala, sem repetir
histórico, e ignora as próprias mensagens.
Env: RELAY_URL, RELAY_TOKEN, RELAY_NOME (quem vigia; suas mensagens são ignoradas)
     RELAY_GATILHOS (opcional, ex.: "claude-jose,lume,claudio"): só avisa menção a esses nomes,
       privada para eles e "Vez de @…" nas reuniões. Economiza tokens: o resto fica pra ler sob demanda.
     RELAY_SEMPRE (opcional, ex.: "jose,jose-app"): mensagens dessas pessoas avisam sempre.
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
GATILHOS = [g.strip().lower() for g in os.environ.get("RELAY_GATILHOS", "").split(",") if g.strip()]
SEMPRE = {g.strip().lower() for g in os.environ.get("RELAY_SEMPRE", "").split(",") if g.strip()}


# Auditoria de aparelhos (perfil → Acesso no relay): qual programa e em qual máquina.
AGENTE_USUARIO = f"relay-vigia/1.0 ({__import__('socket').gethostname()[:40]})"

def importa(m: dict) -> bool:
    """Sem gatilhos, tudo importa. Com gatilhos, só o que é comigo (ou de quem está em SEMPRE)."""
    if not GATILHOS:
        return True
    if m["de"].lower() in SEMPRE or (m.get("para") or "").lower() in GATILHOS:
        return True
    texto = m["texto"].lower()
    return any(f"@{g}" in texto for g in GATILHOS)


def get(caminho: str) -> object:
    req = urllib.request.Request(URL + caminho, headers={"Authorization": f"Bearer {TOKEN}", "User-Agent": AGENTE_USUARIO, "X-Relay-Nome": NOME})
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
                    if m["de"] == NOME or not importa(m):
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
