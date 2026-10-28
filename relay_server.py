#!/usr/bin/env python3
"""Servidor do relay: salas de mensagens entre agentes e pessoas (stdlib + SQLite).

Uso: RELAY_TOKEN=segredo python3 relay_server.py [--host 0.0.0.0] [--porta 8790]

Identidade
- RELAY_TOKEN é o token de **admin**: pode tudo, inclusive assinar com qualquer `de`
  (compatibilidade com clientes antigos) e ler mensagens privadas (`todas=1`).
- Tokens de **agente** são criados pelo admin (POST /agentes). Com eles o servidor
  define o `de` pelo token e nunca entrega mensagem privada de terceiros.
- O dashboard troca um token por uma **sessão em cookie** (POST /sessao). Pedidos com
  cookie exigem o header `X-Relay: 1` (CSRF).

Env opcionais: RELAY_DB, RELAY_RETENCAO_DIAS (0 = guarda tudo), RELAY_MAX_ESPERAS (64).
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

TOKEN_ADMIN = os.environ.get("RELAY_TOKEN", "")
RAIZ = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(RAIZ, "web", "dist")
PAGINA_LEGADA = os.path.join(RAIZ, "dashboard.html")
DB = os.environ.get("RELAY_DB", os.path.join(RAIZ, "relay.sqlite"))
RETENCAO_DIAS = float(os.environ.get("RELAY_RETENCAO_DIAS", "0"))
MAX_ESPERAS = int(os.environ.get("RELAY_MAX_ESPERAS", "64"))

TAM_MAX = 64_000
ESPERA_MAX = 300
SESSAO_DIAS = 30
ONLINE_S = 120
LIMITE_PAGINA = 100
COOKIE = "relay_sessao"

NOVA = threading.Condition()            # acorda long-polls e SSE a cada mudança
ESPERAS = threading.BoundedSemaphore(MAX_ESPERAS)
NOME_RE = re.compile(r"^[\w.-]{1,32}$")
SALA_RE = re.compile(r"^[\w.-]{1,64}$")
# Padrões de credencial (estilo gitleaks). Barrar no POST evita vazamento por engano.
CREDENCIAL_RE = re.compile(
    r"(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}"
    r"|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}"
    r"|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----)"
)

mimetypes.add_type("font/woff2", ".woff2")


# --- Banco -----------------------------------------------------------------

MIGRACOES = [
    # 1: tabela original do protótipo
    """CREATE TABLE IF NOT EXISTS msg (
         id INTEGER PRIMARY KEY, sala TEXT, de TEXT, para TEXT, texto TEXT, criado REAL)""",
    # 2: idempotência, resposta, índices
    """ALTER TABLE msg ADD COLUMN client_id TEXT;
       ALTER TABLE msg ADD COLUMN reply_to INTEGER;
       CREATE INDEX IF NOT EXISTS msg_sala_id ON msg(sala, id);
       CREATE INDEX IF NOT EXISTS msg_para ON msg(para) WHERE para IS NOT NULL;
       CREATE UNIQUE INDEX IF NOT EXISTS msg_de_client ON msg(de, client_id) WHERE client_id IS NOT NULL;""",
    # 3: identidade, presença, sessão, cursor, eventos
    """CREATE TABLE IF NOT EXISTS agente (
         nome TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT 'ia', token_hash TEXT UNIQUE,
         criado REAL NOT NULL, revogado REAL);
       CREATE TABLE IF NOT EXISTS presenca (nome TEXT PRIMARY KEY, visto REAL NOT NULL);
       CREATE TABLE IF NOT EXISTS sessao (
         id_hash TEXT PRIMARY KEY, nome TEXT NOT NULL, admin INTEGER NOT NULL, expira REAL NOT NULL);
       CREATE TABLE IF NOT EXISTS cursor (
         nome TEXT NOT NULL, sala TEXT NOT NULL, ultimo_id INTEGER NOT NULL, PRIMARY KEY (nome, sala));
       CREATE TABLE IF NOT EXISTS evento (
         seq INTEGER PRIMARY KEY, tipo TEXT NOT NULL, sala TEXT NOT NULL, msg_id INTEGER NOT NULL, quando REAL NOT NULL);""",
]


def conectar() -> sqlite3.Connection:
    con = sqlite3.connect(DB, timeout=10)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=5000")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def migrar() -> None:
    con = conectar()
    try:
        versao = con.execute("PRAGMA user_version").fetchone()[0]
        for i, sql in enumerate(MIGRACOES[versao:], start=versao + 1):
            for comando in filter(str.strip, sql.split(";")):
                try:
                    con.execute(comando)
                except sqlite3.OperationalError as e:
                    if "duplicate column" not in str(e):
                        raise
            con.execute(f"PRAGMA user_version={i}")
            con.commit()
    finally:
        con.close()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def notificar() -> None:
    with NOVA:
        NOVA.notify_all()


# --- Erros -----------------------------------------------------------------

class ErroHttp(Exception):
    """Vira application/problem+json (RFC 9457) com `codigo` estável."""

    def __init__(self, status: int, codigo: str, detalhe: str, retry_after: int | None = None):
        super().__init__(detalhe)
        self.status, self.codigo, self.detalhe, self.retry_after = status, codigo, detalhe, retry_after


TITULOS = {400: "Pedido inválido", 401: "Não autenticado", 403: "Proibido", 404: "Não encontrado",
           405: "Método não permitido", 409: "Conflito", 411: "Tamanho obrigatório", 413: "Grande demais",
           422: "Conteúdo recusado", 429: "Muitos pedidos", 503: "Ocupado"}


# --- Limite de taxa (token bucket por identidade) --------------------------

class Balde:
    def __init__(self, capacidade: float, por_segundo: float):
        self.capacidade, self.por_segundo = capacidade, por_segundo
        self.estado: dict[str, tuple[float, float]] = {}
        self.trava = threading.Lock()

    def consumir(self, chave: str) -> int | None:
        """None se pode; senão segundos até poder."""
        agora = time.monotonic()
        with self.trava:
            fichas, antes = self.estado.get(chave, (self.capacidade, agora))
            fichas = min(self.capacidade, fichas + (agora - antes) * self.por_segundo)
            if fichas >= 1:
                self.estado[chave] = (fichas - 1, agora)
                return None
            self.estado[chave] = (fichas, agora)
            return max(1, int((1 - fichas) / self.por_segundo + 0.999))


ENVIOS = Balde(capacidade=10, por_segundo=0.5)   # rajada de 10, depois 30/min


# --- Identidade ------------------------------------------------------------

@dataclass
class Quem:
    nome: str | None      # None = admin sem nome (cliente antigo)
    admin: bool
    via_cookie: bool = False


def identificar(headers, con: sqlite3.Connection) -> Quem:
    auth = headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        if TOKEN_ADMIN and hmac.compare_digest(token, TOKEN_ADMIN):
            return Quem(None, True)
        linha = con.execute(
            "SELECT nome FROM agente WHERE token_hash=? AND revogado IS NULL", (hash_token(token),)
        ).fetchone()
        if linha:
            return Quem(linha[0], False)
        raise ErroHttp(401, "token_invalido", "Token inválido ou revogado.")
    cookie = SimpleCookie(headers.get("Cookie", ""))
    if COOKIE in cookie:
        linha = con.execute(
            "SELECT nome, admin FROM sessao WHERE id_hash=? AND expira>?",
            (hash_token(cookie[COOKIE].value), time.time()),
        ).fetchone()
        if linha:
            if headers.get("X-Relay") != "1":
                raise ErroHttp(403, "csrf", "Header X-Relay ausente.")
            return Quem(linha[0], bool(linha[1]), via_cookie=True)
        raise ErroHttp(401, "sessao_expirada", "Sessão expirada. Entre de novo.")
    if not TOKEN_ADMIN:  # modo local sem token: tudo liberado
        return Quem(None, True)
    raise ErroHttp(401, "token_invalido", "Envie Authorization: Bearer <token>.")


def marcar_visto(con: sqlite3.Connection, nome: str | None) -> None:
    if nome and NOME_RE.match(nome):
        con.execute(
            "INSERT INTO presenca (nome, visto) VALUES (?, ?) ON CONFLICT(nome) DO UPDATE SET visto=excluded.visto",
            (nome, time.time()),
        )


# --- Consultas -------------------------------------------------------------

COLUNAS = "id, de, para, texto, criado, client_id, reply_to"


def linha_para_msg(r: tuple) -> dict:
    i, de, para, texto, criado, client_id, reply_to = r
    m = {"id": i, "de": de, "para": para, "texto": texto, "criado": criado, "criado_em": iso(criado)}
    if client_id:
        m["client_id"] = client_id
    if reply_to:
        m["reply_to"] = reply_to
    return m


def filtro_visiveis(quem: Quem, eu: str | None, todas: bool) -> tuple[str, list]:
    """Admin com todas=1 vê tudo; os outros veem públicas, as suas e as endereçadas a si."""
    if quem.admin and todas:
        return "1", []
    return "(para IS NULL OR para=? OR de=?)", [eu, eu]


def validar_sala(sala: str | None) -> str:
    if not sala or not SALA_RE.match(sala):
        raise ErroHttp(400, "sala_invalida", "Sala deve ter 1–64 caracteres: letras, números, . - _")
    return sala


# --- HTTP ------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "relay/2"

    def handle(self) -> None:
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass  # cliente cancelou (ex.: dashboard trocou de sala durante o long-poll)

    def log_message(self, *_: object) -> None:
        pass

    # respostas

    def _enviar(self, status: int, corpo: bytes, tipo: str, extras: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extras or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(corpo)

    def _json(self, status: int, corpo: object, extras: dict[str, str] | None = None) -> None:
        self._enviar(status, json.dumps(corpo, ensure_ascii=False).encode(), "application/json; charset=utf-8", extras)

    def _vazio(self, extras: dict[str, str] | None = None) -> None:
        self.send_response(204)
        self.send_header("Content-Length", "0")
        for k, v in (extras or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _problema(self, e: ErroHttp) -> None:
        corpo = {"type": "about:blank", "title": TITULOS.get(e.status, "Erro"), "status": e.status,
                 "detail": e.detalhe, "codigo": e.codigo, "erro": e.detalhe}
        extras = {"Retry-After": str(e.retry_after)} if e.retry_after else None
        self.close_connection = True  # corpo pode ter ficado sem ler: não reaproveita a conexão
        self._enviar(e.status, json.dumps(corpo, ensure_ascii=False).encode(),
                     "application/problem+json; charset=utf-8", extras)

    def _corpo(self) -> dict:
        bruto = self.headers.get("Content-Length")
        if bruto is None:
            raise ErroHttp(411, "tamanho_obrigatorio", "Content-Length obrigatório.")
        try:
            tam = int(bruto)
        except ValueError:
            raise ErroHttp(400, "tamanho_invalido", "Content-Length inválido.") from None
        if tam < 0:
            raise ErroHttp(400, "tamanho_invalido", "Content-Length inválido.")
        if tam > TAM_MAX:
            raise ErroHttp(413, "mensagem_grande", "Mensagem grande demais (máx. 64 KB).")
        try:
            dados = json.loads(self.rfile.read(tam) or b"{}")
        except ValueError:
            raise ErroHttp(400, "json_invalido", "JSON inválido.") from None
        if not isinstance(dados, dict):
            raise ErroHttp(400, "json_invalido", "Esperado um objeto JSON.")
        return dados

    # roteamento

    def _rotear(self, metodo: str) -> None:
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        caminho = url.path.rstrip("/") or "/"
        try:
            if metodo == "GET" and self._estatico(url.path):
                return
            rotas = {
                ("POST", "/sessao"): self.criar_sessao,
                ("DELETE", "/sessao"): self.apagar_sessao,
                ("GET", "/eu"): self.eu,
                ("GET", "/salas"): self.salas,
                ("GET", "/mensagens"): self.mensagens,
                ("GET", "/mensagens/historico"): self.historico,
                ("GET", "/mensagens/stream"): self.stream,
                ("POST", "/mensagens"): self.postar,
                ("GET", "/agentes"): self.agentes,
                ("POST", "/agentes"): self.criar_agente,
            }
            if (metodo, caminho) in rotas:
                return rotas[(metodo, caminho)](q)
            m = re.fullmatch(r"/mensagens/(\d+)", caminho)
            if m and metodo == "DELETE":
                return self.apagar_mensagem(int(m.group(1)))
            m = re.fullmatch(r"/agentes/([^/]+)", caminho)
            if m and metodo == "DELETE":
                return self.revogar_agente(unquote(m.group(1)))
            raise ErroHttp(404, "rota", f"Rota {metodo} {caminho} não existe.")
        except ErroHttp as e:
            self._problema(e)
        except ValueError:
            self._problema(ErroHttp(400, "parametro_invalido", "Parâmetro numérico inválido."))

    def do_GET(self) -> None:
        self._rotear("GET")

    def do_POST(self) -> None:
        self._rotear("POST")

    def do_DELETE(self) -> None:
        self._rotear("DELETE")

    def _estatico(self, caminho: str) -> bool:
        """Serve o build do Vite (web/dist); sem build, o dashboard.html legado."""
        alvo, cache = None, "no-cache"
        if not os.path.isdir(DIST):
            if caminho == "/":
                alvo = PAGINA_LEGADA
        elif caminho in ("/", "/entrar", "/config") or caminho.startswith("/s/"):
            alvo = os.path.join(DIST, "index.html")  # rotas do app (TanStack Router)
        else:
            real = os.path.realpath(os.path.join(DIST, caminho.lstrip("/")))
            if real.startswith(DIST + os.sep) and os.path.isfile(real):
                alvo = real
                if real.startswith(os.path.join(DIST, "assets") + os.sep):
                    cache = "public, max-age=31536000, immutable"  # nome com hash
        if not alvo:
            return False
        with open(alvo, "rb") as f:
            dados = f.read()
        tipo = mimetypes.guess_type(alvo)[0] or "application/octet-stream"
        extras = {"Cache-Control": cache}
        if alvo.endswith(".html"):
            extras["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
                "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; "
                "script-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
                "img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
            )
            extras["Referrer-Policy"] = "no-referrer"
        self._enviar(200, dados, tipo + ("; charset=utf-8" if tipo.startswith("text/") else ""), extras)
        return True

    # sessão

    def _quem(self, con: sqlite3.Connection) -> Quem:
        quem = identificar(self.headers, con)
        marcar_visto(con, quem.nome)
        return quem

    def criar_sessao(self, _q: dict) -> None:
        corpo = self._corpo()
        token = str(corpo.get("token", ""))
        with conectar() as con:
            if TOKEN_ADMIN and hmac.compare_digest(token, TOKEN_ADMIN):
                nome, admin = str(corpo.get("nome", "")).strip(), True
                if not NOME_RE.match(nome):
                    raise ErroHttp(400, "nome_invalido", "Nome deve ter 1–32 caracteres: letras, números, . - _")
            else:
                linha = con.execute(
                    "SELECT nome FROM agente WHERE token_hash=? AND revogado IS NULL", (hash_token(token),)
                ).fetchone()
                if not linha:
                    raise ErroHttp(401, "token_invalido", "Token inválido ou revogado.")
                nome, admin = linha[0], False
            sid = secrets.token_urlsafe(32)
            con.execute("DELETE FROM sessao WHERE expira<?", (time.time(),))
            con.execute("INSERT INTO sessao VALUES (?,?,?,?)",
                        (hash_token(sid), nome, int(admin), time.time() + SESSAO_DIAS * 86400))
            marcar_visto(con, nome)
        seguro = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        self._json(200, {"nome": nome, "admin": admin}, {
            "Set-Cookie": f"{COOKIE}={sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSAO_DIAS * 86400}{seguro}"
        })

    def apagar_sessao(self, _q: dict) -> None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        if COOKIE in cookie:
            with conectar() as con:
                con.execute("DELETE FROM sessao WHERE id_hash=?", (hash_token(cookie[COOKIE].value),))
        self._vazio({"Set-Cookie": f"{COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})

    def eu(self, _q: dict) -> None:
        with conectar() as con:
            quem = self._quem(con)
        self._json(200, {"nome": quem.nome, "admin": quem.admin})

    # salas e agentes

    def salas(self, _q: dict) -> None:
        with conectar() as con:
            self._quem(con)
            linhas = con.execute(
                """SELECT sala, COUNT(*), MAX(criado), MAX(id), GROUP_CONCAT(DISTINCT de)
                   FROM msg GROUP BY sala ORDER BY MAX(id) DESC"""
            ).fetchall()
        self._json(200, [
            {"sala": s, "total": n, "ultima": u, "ultimo_id": ult, "agentes": (a or "").split(",")}
            for s, n, u, ult, a in linhas
        ])

    def agentes(self, _q: dict) -> None:
        with conectar() as con:
            self._quem(con)
            linhas = con.execute(
                """SELECT p.nome, p.visto, a.tipo, a.token_hash IS NOT NULL AND a.revogado IS NULL
                   FROM presenca p LEFT JOIN agente a ON a.nome = p.nome
                   UNION
                   SELECT a.nome, NULL, a.tipo, a.revogado IS NULL FROM agente a
                   WHERE a.nome NOT IN (SELECT nome FROM presenca)
                   ORDER BY 1"""
            ).fetchall()
        agora = time.time()
        self._json(200, [
            {"nome": n, "visto_em": iso(v) if v else None, "online": bool(v and agora - v < ONLINE_S),
             "tipo": t or ("ia" if re.match(r"^(claude|gemma|qwen|llama|gpt)", n) else "humano"),
             "tem_token": bool(tk)}
            for n, v, t, tk in linhas
        ])

    def criar_agente(self, _q: dict) -> None:
        corpo = self._corpo()
        nome, tipo = str(corpo.get("nome", "")).strip(), str(corpo.get("tipo", "ia"))
        if not NOME_RE.match(nome):
            raise ErroHttp(400, "nome_invalido", "Nome deve ter 1–32 caracteres: letras, números, . - _")
        if tipo not in ("ia", "humano"):
            raise ErroHttp(400, "tipo_invalido", "Tipo deve ser 'ia' ou 'humano'.")
        token = "rly_" + secrets.token_urlsafe(32)
        with conectar() as con:
            if not self._quem(con).admin:
                raise ErroHttp(403, "proibido", "Só o admin cria agentes.")
            ativo = con.execute("SELECT 1 FROM agente WHERE nome=? AND revogado IS NULL AND token_hash IS NOT NULL",
                                (nome,)).fetchone()
            if ativo:
                raise ErroHttp(409, "nome_em_uso", "Esse nome já tem um token ativo. Revogue antes.")
            con.execute(
                """INSERT INTO agente (nome, tipo, token_hash, criado) VALUES (?,?,?,?)
                   ON CONFLICT(nome) DO UPDATE SET tipo=excluded.tipo, token_hash=excluded.token_hash,
                     criado=excluded.criado, revogado=NULL""",
                (nome, tipo, hash_token(token), time.time()),
            )
        # O token só aparece aqui, uma vez.
        self._json(201, {"nome": nome, "tipo": tipo, "token": token})

    def revogar_agente(self, nome: str) -> None:
        with conectar() as con:
            if not self._quem(con).admin:
                raise ErroHttp(403, "proibido", "Só o admin revoga agentes.")
            cur = con.execute("UPDATE agente SET revogado=? WHERE nome=? AND revogado IS NULL", (time.time(), nome))
            if not cur.rowcount:
                raise ErroHttp(404, "agente_inexistente", "Agente sem token ativo.")
            con.execute("DELETE FROM sessao WHERE nome=? AND admin=0", (nome,))
        self._vazio()

    # mensagens

    def postar(self, _q: dict) -> None:
        corpo = self._corpo()
        sala = validar_sala(corpo.get("sala"))
        texto = corpo.get("texto")
        if not isinstance(texto, str) or not texto.strip():
            raise ErroHttp(400, "texto_vazio", "Texto obrigatório.")
        if CREDENCIAL_RE.search(texto):
            raise ErroHttp(422, "credencial_detectada",
                           "A mensagem parece conter uma credencial (token, chave, senha). Não foi enviada.")
        para = corpo.get("para") or None
        if para is not None and (not isinstance(para, str) or not NOME_RE.match(para)):
            raise ErroHttp(400, "para_invalido", "Destinatário inválido.")
        client_id = corpo.get("client_id") or None
        if client_id is not None and (not isinstance(client_id, str) or len(client_id) > 64):
            raise ErroHttp(400, "client_id_invalido", "client_id deve ser texto de até 64 caracteres.")
        reply_to = corpo.get("reply_to")
        if reply_to is not None and not isinstance(reply_to, int):
            raise ErroHttp(400, "reply_to_invalido", "reply_to deve ser o id de uma mensagem.")
        with conectar() as con:
            quem = self._quem(con)
            # Agente e sessão: o servidor define o `de`. Só o token de admin (clientes antigos) escolhe.
            if quem.admin and not quem.via_cookie:
                de = str(corpo.get("de") or quem.nome or "").strip()
            else:
                de = quem.nome or ""
            if not NOME_RE.match(de or ""):
                raise ErroHttp(400, "nome_invalido", "Remetente (de) inválido.")
            espera = ENVIOS.consumir(de)
            if espera:
                raise ErroHttp(429, "limite_excedido", "Devagar: limite de envio atingido.", espera)
            if client_id:
                existente = con.execute("SELECT id FROM msg WHERE de=? AND client_id=?", (de, client_id)).fetchone()
                if existente:
                    return self._json(200, {"id": existente[0], "repetida": True})
            cur = con.execute(
                "INSERT INTO msg (sala, de, para, texto, criado, client_id, reply_to) VALUES (?,?,?,?,?,?,?)",
                (sala, de, para, texto, time.time(), client_id, reply_to),
            )
            marcar_visto(con, de)
        notificar()
        self._json(201, {"id": cur.lastrowid})

    def apagar_mensagem(self, msg_id: int) -> None:
        with conectar() as con:
            quem = self._quem(con)
            linha = con.execute("SELECT sala, de FROM msg WHERE id=?", (msg_id,)).fetchone()
            if not linha:
                raise ErroHttp(404, "mensagem_inexistente", "Mensagem não existe.")
            sala, autor = linha
            if not (quem.admin or quem.nome == autor):
                raise ErroHttp(403, "proibido", "Só o autor ou o admin apagam.")
            # Apagamento real; o evento guarda só o id (auditoria sem conteúdo).
            con.execute("DELETE FROM msg WHERE id=?", (msg_id,))
            con.execute("INSERT INTO evento (tipo, sala, msg_id, quando) VALUES ('apagada',?,?,?)",
                        (sala, msg_id, time.time()))
        notificar()
        self._vazio()

    def _ler(self, con: sqlite3.Connection, quem: Quem, sala: str, eu: str | None, todas: bool,
             depois: int, sem_minhas: bool) -> list[dict]:
        filtro, args = filtro_visiveis(quem, eu, todas)
        extra = " AND de IS NOT ?" if sem_minhas else ""
        linhas = con.execute(
            f"SELECT {COLUNAS} FROM msg WHERE sala=? AND id>? AND {filtro}{extra} ORDER BY id LIMIT 200",
            [sala, depois, *args, *([eu] if sem_minhas else [])],
        ).fetchall()
        return [linha_para_msg(r) for r in linhas]

    def mensagens(self, q: dict) -> None:
        """Leitura e espera longa. Sem `depois`, usa o cursor salvo do agente (MCP)."""
        sala = validar_sala(q.get("sala"))
        espera = min(max(float(q.get("espera", 0) or 0), 0), ESPERA_MAX)
        with conectar() as con:
            quem = self._quem(con)
        eu = quem.nome if (quem.nome and not quem.admin) else (q.get("eu") or quem.nome)
        marcar_visto_sem_con(eu)
        todas = q.get("todas") == "1"
        usa_cursor = "depois" not in q and eu is not None
        if usa_cursor:
            with conectar() as con:
                linha = con.execute("SELECT ultimo_id FROM cursor WHERE nome=? AND sala=?", (eu, sala)).fetchone()
                if linha:
                    depois = linha[0]
                else:  # primeiro acesso: começa do fim, sem reentregar o histórico
                    depois = con.execute("SELECT COALESCE(MAX(id),0) FROM msg WHERE sala=?", (sala,)).fetchone()[0]
                    con.execute("INSERT OR REPLACE INTO cursor VALUES (?,?,?)", (eu, sala, depois))
        else:
            depois = int(q.get("depois", 0) or 0)
        msgs = self._esperar(quem, sala, eu, todas, depois, espera)
        if usa_cursor and msgs:
            with conectar() as con:
                con.execute("INSERT OR REPLACE INTO cursor VALUES (?,?,?)", (eu, sala, msgs[-1]["id"]))
        self._json(200, msgs)

    def _esperar(self, quem: Quem, sala: str, eu: str | None, todas: bool, depois: int, espera: float) -> list[dict]:
        if espera and not ESPERAS.acquire(blocking=False):
            raise ErroHttp(503, "ocupado", "Muitas esperas abertas; tente de novo.", 2)
        try:
            limite = time.monotonic() + espera
            while True:
                with conectar() as con:
                    # Esperando: só interessa mensagem dos outros; lendo: inclui as próprias.
                    msgs = self._ler(con, quem, sala, eu, todas, depois, sem_minhas=bool(espera) and eu is not None)
                restante = limite - time.monotonic()
                if msgs or restante <= 0:
                    return msgs
                with NOVA:
                    NOVA.wait(min(restante, 5))
        finally:
            if espera:
                ESPERAS.release()

    def historico(self, q: dict) -> None:
        sala = validar_sala(q.get("sala"))
        limite = min(max(int(q.get("limite", 50) or 50), 1), LIMITE_PAGINA)
        antes = int(q["antes"]) if q.get("antes") else None
        with conectar() as con:
            quem = self._quem(con)
            eu = quem.nome if (quem.nome and not quem.admin) else (q.get("eu") or quem.nome)
            filtro, args = filtro_visiveis(quem, eu, q.get("todas") == "1")
            cond = " AND id<?" if antes else ""
            linhas = con.execute(
                f"SELECT {COLUNAS} FROM msg WHERE sala=? AND {filtro}{cond} ORDER BY id DESC LIMIT ?",
                [sala, *args, *([antes] if antes else []), limite + 1],
            ).fetchall()
        tem_mais = len(linhas) > limite
        msgs = [linha_para_msg(r) for r in reversed(linhas[:limite])]
        self._json(200, {"mensagens": msgs, "tem_mais": tem_mais})

    def stream(self, q: dict) -> None:
        """SSE: `id` do evento = id da mensagem; reconecta com Last-Event-ID."""
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            quem = self._quem(con)
            ultimo_evento = con.execute("SELECT COALESCE(MAX(seq),0) FROM evento").fetchone()[0]
        eu = quem.nome if (quem.nome and not quem.admin) else (q.get("eu") or quem.nome)
        todas = q.get("todas") == "1"
        depois = int(self.headers.get("Last-Event-ID") or q.get("depois") or 0)
        if not ESPERAS.acquire(blocking=False):
            raise ErroHttp(503, "ocupado", "Muitas conexões abertas; tente de novo.", 2)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            self.close_connection = True
            self.wfile.write(b"retry: 3000\n\n")
            self.wfile.flush()
            fim = time.monotonic() + 1800  # recicla a conexão a cada 30 min
            ping = time.monotonic()
            while time.monotonic() < fim:
                with conectar() as con:
                    msgs = self._ler(con, quem, sala, eu, todas, depois, sem_minhas=False)
                    eventos = con.execute(
                        "SELECT seq, msg_id FROM evento WHERE seq>? AND sala=? ORDER BY seq", (ultimo_evento, sala)
                    ).fetchall()
                    if eu:
                        marcar_visto(con, eu)
                for m in msgs:
                    depois = m["id"]
                    dados = json.dumps(m, ensure_ascii=False)
                    self.wfile.write(f"id: {m['id']}\nevent: mensagem\ndata: {dados}\n\n".encode())
                for seq, msg_id in eventos:
                    ultimo_evento = seq
                    self.wfile.write(f"event: apagada\ndata: {json.dumps({'id': msg_id})}\n\n".encode())
                if msgs or eventos:
                    self.wfile.flush()
                    continue
                if time.monotonic() - ping > 15:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    ping = time.monotonic()
                with NOVA:
                    NOVA.wait(15)
        finally:
            ESPERAS.release()


def marcar_visto_sem_con(nome: str | None) -> None:
    if nome:
        with conectar() as con:
            marcar_visto(con, nome)


def faxina() -> None:
    """Retenção e limpeza de sessões vencidas (thread de fundo)."""
    while True:
        try:
            with conectar() as con:
                con.execute("DELETE FROM sessao WHERE expira<?", (time.time(),))
                con.execute("DELETE FROM evento WHERE quando<?", (time.time() - 86400,))
                if RETENCAO_DIAS > 0:
                    con.execute("DELETE FROM msg WHERE criado<?", (time.time() - RETENCAO_DIAS * 86400,))
        except sqlite3.Error as e:
            print(f"faxina falhou: {e}", flush=True)
        time.sleep(3600)


class Servidor(ThreadingHTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--porta", type=int, default=8790)
    a = ap.parse_args()
    if a.host != "127.0.0.1" and not TOKEN_ADMIN:
        raise SystemExit("defina RELAY_TOKEN para expor fora do localhost")
    migrar()
    threading.Thread(target=faxina, daemon=True).start()
    print(f"relay v2 em http://{a.host}:{a.porta}", flush=True)
    Servidor((a.host, a.porta), Handler).serve_forever()
