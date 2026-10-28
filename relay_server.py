#!/usr/bin/env python3
"""Servidor do relay: caixa de mensagens HTTP entre agentes (stdlib + SQLite).

Uso: RELAY_TOKEN=segredo python3 relay_server.py [--host 0.0.0.0] [--porta 8790]
"""
import argparse
import json
import mimetypes
import os
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TOKEN = os.environ.get("RELAY_TOKEN", "")
NOVA = threading.Condition()
mimetypes.add_type("font/woff2", ".woff2")
RAIZ = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(RAIZ, "web", "dist")
PAGINA_LEGADA = os.path.join(RAIZ, "dashboard.html")
DB = os.environ.get("RELAY_DB", os.path.join(os.path.dirname(__file__), "relay.sqlite"))


def conectar() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute(
        """CREATE TABLE IF NOT EXISTS msg (
            id INTEGER PRIMARY KEY, sala TEXT, de TEXT, para TEXT,
            texto TEXT, criado REAL)"""
    )
    return con


class Handler(BaseHTTPRequestHandler):
    def handle(self) -> None:
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            # Cliente cancelou (ex.: dashboard trocou de sala durante o long-poll).
            pass

    def _json(self, codigo: int, corpo: object) -> None:
        dados = json.dumps(corpo, ensure_ascii=False).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    @staticmethod
    def _arquivo_estatico(caminho: str) -> tuple[str, str] | None:
        """Build do Vite (web/dist) se existir; senão o dashboard.html legado."""
        if not os.path.isdir(DIST):
            return (PAGINA_LEGADA, "no-cache") if caminho == "/" else None
        # Rotas do app (TanStack Router) caem no index.html; a API nunca.
        if caminho == "/" or caminho == "/entrar" or caminho.startswith("/s/"):
            return os.path.join(DIST, "index.html"), "no-cache"
        alvo = os.path.realpath(os.path.join(DIST, caminho.lstrip("/")))
        if not alvo.startswith(DIST + os.sep) or not os.path.isfile(alvo):
            return None
        # Arquivos em assets/ têm hash no nome: podem ficar em cache para sempre.
        imutavel = alvo.startswith(os.path.join(DIST, "assets") + os.sep)
        return alvo, "public, max-age=31536000, immutable" if imutavel else "no-cache"

    def _autorizado(self) -> bool:
        if TOKEN and self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self._json(401, {"erro": "token inválido"})
            return False
        return True

    def do_POST(self) -> None:
        if not self._autorizado():
            return
        if urlparse(self.path).path != "/mensagens":
            return self._json(404, {"erro": "rota"})
        tam = int(self.headers.get("Content-Length", 0))
        if tam > 64_000:
            return self._json(413, {"erro": "mensagem grande demais"})
        try:
            m = json.loads(self.rfile.read(tam))
            sala, de, texto = str(m["sala"]), str(m["de"]), str(m["texto"])
        except (ValueError, KeyError):
            return self._json(400, {"erro": "esperado {sala, de, texto, para?}"})
        para = str(m["para"]) if m.get("para") else None
        with conectar() as con:
            cur = con.execute(
                "INSERT INTO msg (sala, de, para, texto, criado) VALUES (?,?,?,?,?)",
                (sala, de, para, texto, time.time()),
            )
        with NOVA:
            NOVA.notify_all()
        self._json(201, {"id": cur.lastrowid})

    def do_GET(self) -> None:
        url = urlparse(self.path)
        estatico = self._arquivo_estatico(url.path)
        if estatico:
            # Front não carrega dados sozinho: pede o token e chama a API.
            caminho, cache = estatico
            with open(caminho, "rb") as f:
                dados = f.read()
            tipo = mimetypes.guess_type(caminho)[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", tipo + ("; charset=utf-8" if tipo.startswith("text/") else ""))
            self.send_header("Content-Length", str(len(dados)))
            self.send_header("Cache-Control", cache)
            self.end_headers()
            self.wfile.write(dados)
            return
        if not self._autorizado():
            return
        if url.path == "/salas":
            with conectar() as con:
                linhas = con.execute(
                    """SELECT sala, COUNT(*), MAX(criado), GROUP_CONCAT(DISTINCT de)
                       FROM msg GROUP BY sala ORDER BY MAX(criado) DESC"""
                ).fetchall()
            return self._json(200, [
                {"sala": s, "total": n, "ultima": u, "agentes": (a or "").split(",")}
                for s, n, u, a in linhas
            ])
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path != "/mensagens" or "sala" not in q:
            return self._json(404, {"erro": "use /mensagens?sala=X&depois=ID&eu=NOME&espera=SEG"})
        depois = int(q.get("depois", 0))
        eu = q.get("eu")
        espera = min(max(float(q.get("espera", 0)), 0), 300)
        limite = time.monotonic() + espera
        while True:
            # Esperando: só interessa mensagem dos outros; lendo: inclui as próprias.
            with conectar() as con:
                linhas = con.execute(
                    """SELECT id, de, para, texto, criado FROM msg
                       WHERE sala=? AND id>? AND (para IS NULL OR para=? OR de=? OR ?)
                         AND NOT (? AND de IS ?)
                       ORDER BY id LIMIT 200""",
                    (q["sala"], depois, eu, eu, q.get("todas") == "1", bool(espera), eu),
                ).fetchall()
            restante = limite - time.monotonic()
            if linhas or restante <= 0:
                break
            with NOVA:
                NOVA.wait(min(restante, 5))
        self._json(200, [
            {"id": i, "de": d, "para": p, "texto": t, "criado": c}
            for i, d, p, t, c in linhas
        ])

    def log_message(self, *_: object) -> None:
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--porta", type=int, default=8790)
    a = ap.parse_args()
    if a.host != "127.0.0.1" and not TOKEN:
        raise SystemExit("defina RELAY_TOKEN para expor fora do localhost")
    conectar().close()
    print(f"relay em http://{a.host}:{a.porta}")
    ThreadingHTTPServer((a.host, a.porta), Handler).serve_forever()
