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
import ssl
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

TOKEN_ADMIN = os.environ.get("RELAY_TOKEN", "")
TLS_PORTAS: set[int] = set()  # portas servidas com TLS (cookie Secure só nelas)
RAIZ = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(RAIZ, "web", "dist")
PAGINA_LEGADA = os.path.join(RAIZ, "dashboard.html")
DB = os.environ.get("RELAY_DB", os.path.join(RAIZ, "relay.sqlite"))
RETENCAO_DIAS = float(os.environ.get("RELAY_RETENCAO_DIAS", "0"))
MAX_ESPERAS = int(os.environ.get("RELAY_MAX_ESPERAS", "64"))

TAM_MAX = 64_000
ARQUIVO_MAX = int(os.environ.get("RELAY_ARQUIVO_MAX_MB", "25")) * 1024 * 1024
PASTA_ARQUIVOS = os.environ.get("RELAY_ARQUIVOS", os.path.join(RAIZ, "arquivos"))
# Só estes abrem no navegador; o resto sempre baixa (HTML/SVG nunca são servidos como página).
TIPOS_EXIBIVEIS = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "application/pdf",
                   "audio/mpeg", "audio/ogg", "audio/wav", "video/mp4", "video/webm", "text/plain"}
ESPERA_MAX = 300
SESSAO_DIAS = 30
ONLINE_S = 120
LIMITE_PAGINA = 100
COOKIE = "relay_sessao"

NOVA = threading.Condition()
# "Digitando": efêmero, só em memória. sala -> {nome: expira (monotonic)}
DIGITANDO: dict[str, dict[str, float]] = {}
TRAVA_DIGITANDO = threading.Lock()
DIGITANDO_TTL = 6.0


def digitando_em(sala: str) -> list[str]:
    agora = time.monotonic()
    with TRAVA_DIGITANDO:
        nomes = DIGITANDO.get(sala, {})
        for n in [n for n, t in nomes.items() if t <= agora]:
            del nomes[n]
        return sorted(nomes)


def proxima_expiracao(sala: str) -> float | None:
    with TRAVA_DIGITANDO:
        ts = DIGITANDO.get(sala, {}).values()
        return min(ts) - time.monotonic() if ts else None            # acorda long-polls e SSE a cada mudança
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
    # 4: tarefas, sprints e reuniões (teste; o back em Rust define o definitivo)
    """CREATE TABLE IF NOT EXISTS sprint (
         id INTEGER PRIMARY KEY, sala TEXT NOT NULL, nome TEXT NOT NULL, objetivo TEXT,
         inicio REAL NOT NULL, fim REAL, ativa INTEGER NOT NULL DEFAULT 1);
       CREATE TABLE IF NOT EXISTS tarefa (
         id INTEGER PRIMARY KEY, sala TEXT NOT NULL, titulo TEXT NOT NULL, descricao TEXT,
         status TEXT NOT NULL DEFAULT 'a_fazer', responsavel TEXT, sprint_id INTEGER, msg_id INTEGER,
         criada_por TEXT NOT NULL, criado REAL NOT NULL, atualizado REAL NOT NULL, prazo REAL);
       CREATE INDEX IF NOT EXISTS tarefa_sala ON tarefa(sala, status);
       CREATE TABLE IF NOT EXISTS reuniao (
         id INTEGER PRIMARY KEY, sala TEXT NOT NULL, titulo TEXT NOT NULL, formato TEXT NOT NULL,
         pauta TEXT NOT NULL, participantes TEXT NOT NULL, item INTEGER NOT NULL DEFAULT 0,
         vez INTEGER NOT NULL DEFAULT 0, rodada INTEGER NOT NULL DEFAULT 1, estado TEXT NOT NULL DEFAULT 'aberta',
         inicio REAL NOT NULL, limite REAL, ata TEXT, criada_por TEXT NOT NULL);""",
    # 5: cada reunião tem um canal próprio (sala "<sala>.reuniao-<id>")
    """ALTER TABLE reuniao ADD COLUMN canal TEXT;
       CREATE INDEX IF NOT EXISTS reuniao_canal ON reuniao(canal);""",
    # 6: arquivos anexados a mensagens (conteúdo em disco, metadados aqui)
    """CREATE TABLE IF NOT EXISTS arquivo (
         id TEXT PRIMARY KEY, nome TEXT NOT NULL, tipo TEXT NOT NULL, tamanho INTEGER NOT NULL,
         sha256 TEXT NOT NULL, de TEXT NOT NULL, criado REAL NOT NULL, msg_id INTEGER);
       CREATE INDEX IF NOT EXISTS arquivo_msg ON arquivo(msg_id);""",
    # 7: até onde cada um leu cada sala (recibo de leitura)
    """CREATE TABLE IF NOT EXISTS leitura (
         nome TEXT NOT NULL, sala TEXT NOT NULL, ultimo_id INTEGER NOT NULL, quando REAL NOT NULL,
         PRIMARY KEY (nome, sala));""",
]

STATUS_TAREFA = ("a_fazer", "fazendo", "revisao", "feito")
# Formatos prontos: pauta padrão de cada tipo de reunião.
FORMATOS = {
    "daily": ["O que fiz desde a última", "O que vou fazer agora", "Bloqueios"],
    "planejamento": ["Objetivo da sprint", "Tarefas candidatas e estimativas", "Quem pega o quê"],
    "revisao": ["O que foi entregue", "Problemas encontrados", "Ajustes necessários"],
    "livre": ["Assunto"],
}


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


def registrar_evento(con: sqlite3.Connection, tipo: str, sala: str, ref: int) -> None:
    """Evento de tempo real (apagada, tarefa, reuniao): o SSE repassa só o tipo e o id."""
    con.execute("INSERT INTO evento (tipo, sala, msg_id, quando) VALUES (?,?,?,?)", (tipo, sala, ref, time.time()))


def mensagem_sistema(con: sqlite3.Connection, sala: str, texto: str) -> int:
    """Mensagem do próprio relay (de='relay') para marcar eventos na conversa."""
    cur = con.execute("INSERT INTO msg (sala, de, texto, criado) VALUES (?, 'relay', ?, ?)", (sala, texto, time.time()))
    return cur.lastrowid


def tarefa_para_json(r: tuple) -> dict:
    i, sala, titulo, desc, status, resp, sprint, msg, por, criado, atual, prazo = r
    return {"id": i, "sala": sala, "titulo": titulo, "descricao": desc, "status": status, "responsavel": resp,
            "sprint_id": sprint, "msg_id": msg, "criada_por": por, "criado_em": iso(criado),
            "atualizado_em": iso(atual), "prazo": iso(prazo) if prazo else None}


def reuniao_para_json(r: tuple) -> dict:
    i, sala, titulo, formato, pauta, parts, item, vez, rodada, estado, inicio, limite, ata, por, canal = r
    participantes = json.loads(parts)
    pauta_l = json.loads(pauta)
    return {"id": i, "sala": sala, "titulo": titulo, "formato": formato, "pauta": pauta_l, "participantes": participantes,
            "item": item, "item_atual": pauta_l[item] if estado == "aberta" and item < len(pauta_l) else None,
            "vez": participantes[vez] if estado == "aberta" and participantes else None, "rodada": rodada,
            "estado": estado, "inicio_em": iso(inicio), "limite_em": iso(limite) if limite else None,
            "ata": ata, "criada_por": por, "canal": canal or sala}


def registrar_leitura(con: sqlite3.Connection, nome: str | None, sala: str, ultimo_id: int) -> bool:
    """Só avança (nunca volta). Devolve True se mudou (para avisar pelo SSE)."""
    if not nome or nome == "relay" or ultimo_id <= 0:
        return False
    atual = con.execute("SELECT ultimo_id FROM leitura WHERE nome=? AND sala=?", (nome, sala)).fetchone()
    if atual and atual[0] >= ultimo_id:
        return False
    con.execute("INSERT INTO leitura VALUES (?,?,?,?) ON CONFLICT(nome, sala) DO UPDATE SET ultimo_id=excluded.ultimo_id, quando=excluded.quando",
                (nome, sala, ultimo_id, time.time()))
    registrar_evento(con, "leitura", sala, ultimo_id)
    return True


def evento_reuniao(con: sqlite3.Connection, r: dict) -> None:
    """A sala principal (faixa/lista) e o canal da reunião precisam saber da mudança."""
    registrar_evento(con, "reuniao", r["sala"], r["id"])
    if r["canal"] != r["sala"]:
        registrar_evento(con, "reuniao", r["canal"], r["id"])


COLS_TAREFA = "id, sala, titulo, descricao, status, responsavel, sprint_id, msg_id, criada_por, criado, atualizado, prazo"
COLS_REUNIAO = "id, sala, titulo, formato, pauta, participantes, item, vez, rodada, estado, inicio, limite, ata, criada_por, canal"


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


def identificar(headers, con: sqlite3.Connection, metodo: str) -> Quem:
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
            # CSRF: escrita exige header custom; leitura (inclui EventSource, que não manda
            # header) fica protegida pelo SameSite=Strict do cookie.
            if metodo != "GET" and headers.get("X-Relay") != "1":
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


def com_anexos(con: sqlite3.Connection, msgs: list[dict]) -> list[dict]:
    """Preenche `anexos` das mensagens numa consulta só."""
    if not msgs:
        return msgs
    ids = [m["id"] for m in msgs]
    marcas = ",".join("?" * len(ids))
    por_msg: dict[int, list[dict]] = {}
    for aid, nome, tipo, tam, mid in con.execute(
        f"SELECT id, nome, tipo, tamanho, msg_id FROM arquivo WHERE msg_id IN ({marcas}) ORDER BY criado", ids
    ):
        por_msg.setdefault(mid, []).append({"id": aid, "nome": nome, "tipo": tipo, "tamanho": tam, "url": f"/arquivos/{aid}"})
    for m in msgs:
        if m["id"] in por_msg:
            m["anexos"] = por_msg[m["id"]]
    return msgs


def apagar_arquivos(con: sqlite3.Connection, condicao: str, args: list) -> None:
    for (aid,) in con.execute(f"SELECT id FROM arquivo WHERE {condicao}", args).fetchall():
        try:
            os.remove(os.path.join(PASTA_ARQUIVOS, aid))
        except FileNotFoundError:
            pass
    con.execute(f"DELETE FROM arquivo WHERE {condicao}", args)


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
                ("POST", "/arquivos"): self.subir_arquivo,
                ("POST", "/digitando"): self.marcar_digitando,
                ("GET", "/leituras"): self.leituras,
                ("POST", "/leituras"): self.marcar_leitura,
                ("GET", "/tarefas"): self.tarefas,
                ("POST", "/tarefas"): self.criar_tarefa,
                ("GET", "/sprints"): self.sprints,
                ("POST", "/sprints"): self.criar_sprint,
                ("GET", "/reunioes"): self.reunioes,
                ("POST", "/reunioes"): self.criar_reuniao,
            }
            if (metodo, caminho) in rotas:
                return rotas[(metodo, caminho)](q)
            m = re.fullmatch(r"/mensagens/(\d+)", caminho)
            if m and metodo == "DELETE":
                return self.apagar_mensagem(int(m.group(1)))
            m = re.fullmatch(r"/agentes/([^/]+)", caminho)
            if m and metodo == "DELETE":
                return self.revogar_agente(unquote(m.group(1)))
            m = re.fullmatch(r"/arquivos/([\w-]{16,64})", caminho)
            if m and metodo == "GET":
                return self.baixar_arquivo(m.group(1), q)
            m = re.fullmatch(r"/tarefas/(\d+)", caminho)
            if m and metodo in ("PATCH", "DELETE"):
                return (self.alterar_tarefa if metodo == "PATCH" else self.apagar_tarefa)(int(m.group(1)))
            m = re.fullmatch(r"/sprints/(\d+)", caminho)
            if m and metodo == "PATCH":
                return self.alterar_sprint(int(m.group(1)))
            m = re.fullmatch(r"/reunioes/(\d+)(?:/(vez|passar|encerrar))?", caminho)
            if m:
                rid, acao = int(m.group(1)), m.group(2)
                if metodo == "GET" and acao is None:
                    return self.ver_reuniao(rid)
                if metodo == "GET" and acao == "vez":
                    return self.aguardar_vez(rid, q)
                if metodo == "POST" and acao == "passar":
                    return self.passar_vez(rid)
                if metodo == "POST" and acao == "encerrar":
                    return self.encerrar_reuniao(rid)
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

    def do_PATCH(self) -> None:
        self._rotear("PATCH")

    def _estatico(self, caminho: str) -> bool:
        """Serve o build do Vite (web/dist); sem build, o dashboard.html legado."""
        alvo, cache = None, "no-cache"
        if not os.path.isdir(DIST):
            if caminho == "/":
                alvo = PAGINA_LEGADA
        elif caminho in ("/", "/entrar", "/config", "/ds") or caminho.startswith("/s/"):
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
        quem = identificar(self.headers, con, self.command)
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
        tls = self.server.server_address[1] in TLS_PORTAS
        seguro = "; Secure" if tls or self.headers.get("X-Forwarded-Proto") == "https" else ""
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
                """SELECT sala, COUNT(*), MAX(criado), MAX(id), GROUP_CONCAT(DISTINCT CASE WHEN de != 'relay' THEN de END)
                   FROM msg GROUP BY sala ORDER BY MAX(id) DESC"""
            ).fetchall()
            canais = {c: (i, t, e, p) for i, t, e, p, c in con.execute(
                "SELECT id, titulo, estado, sala, canal FROM reuniao WHERE canal IS NOT NULL")}
        saida = []
        for s_, n, u, ult, a in linhas:
            item = {"sala": s_, "total": n, "ultima": u, "ultimo_id": ult, "agentes": [x for x in (a or "").split(",") if x]}
            if s_ in canais:
                i, t, e, p = canais[s_]
                item.update({"pai": p, "reuniao": {"id": i, "titulo": t, "estado": e}})
            saida.append(item)
        self._json(200, saida)

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
        texto = corpo.get("texto") or ""
        anexos = corpo.get("anexos") or []
        if not isinstance(texto, str) or not isinstance(anexos, list) or len(anexos) > 10 \
                or not all(isinstance(a, str) and re.fullmatch(r"[\w-]{16,64}", a) for a in anexos):
            raise ErroHttp(400, "anexos_invalidos", "anexos: lista de até 10 ids de arquivo.")
        if not texto.strip() and not anexos:
            raise ErroHttp(400, "texto_vazio", "Mande texto ou ao menos um arquivo.")
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
            if anexos:
                livres = con.execute(
                    f"SELECT COUNT(*) FROM arquivo WHERE id IN ({','.join('?' * len(anexos))}) AND de=? AND msg_id IS NULL",
                    [*anexos, de]).fetchone()[0]
                if livres != len(set(anexos)):
                    raise ErroHttp(400, "anexos_invalidos", "Arquivo inexistente, de outra pessoa ou já usado.")
            cur = con.execute(
                "INSERT INTO msg (sala, de, para, texto, criado, client_id, reply_to) VALUES (?,?,?,?,?,?,?)",
                (sala, de, para, texto, time.time(), client_id, reply_to),
            )
            if anexos:
                con.execute(f"UPDATE arquivo SET msg_id=? WHERE id IN ({','.join('?' * len(anexos))})", [cur.lastrowid, *anexos])
            marcar_visto(con, de)
            registrar_leitura(con, de, sala, cur.lastrowid)  # quem escreveu leu até ali
        with TRAVA_DIGITANDO:
            DIGITANDO.get(sala, {}).pop(de, None)
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
            apagar_arquivos(con, "msg_id=?", [msg_id])
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
        return com_anexos(con, [linha_para_msg(r) for r in linhas])

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
        if msgs and eu and not quem.via_cookie:
            # Agente que recebeu pela API leu (o dashboard marca leitura sozinho, quando a tela mostra).
            with conectar() as con:
                if usa_cursor:
                    con.execute("INSERT OR REPLACE INTO cursor VALUES (?,?,?)", (eu, sala, msgs[-1]["id"]))
                if registrar_leitura(con, eu, sala, msgs[-1]["id"]):
                    notificar()
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
            msgs = com_anexos(con, [linha_para_msg(r) for r in reversed(linhas[:limite])])
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
            ultimo_digitando: list[str] = []
            while time.monotonic() < fim:
                with conectar() as con:
                    msgs = self._ler(con, quem, sala, eu, todas, depois, sem_minhas=False)
                    eventos = con.execute(
                        "SELECT seq, tipo, msg_id FROM evento WHERE seq>? AND sala=? ORDER BY seq", (ultimo_evento, sala)
                    ).fetchall()
                    if eu:
                        marcar_visto(con, eu)
                for m in msgs:
                    depois = m["id"]
                    dados = json.dumps(m, ensure_ascii=False)
                    self.wfile.write(f"id: {m['id']}\nevent: mensagem\ndata: {dados}\n\n".encode())
                for seq, tipo, ref in eventos:
                    ultimo_evento = seq
                    self.wfile.write(f"event: {tipo}\ndata: {json.dumps({'id': ref})}\n\n".encode())
                digitando = [n for n in digitando_em(sala) if n != eu]
                if digitando != ultimo_digitando:
                    ultimo_digitando = digitando
                    self.wfile.write(f"event: digitando\ndata: {json.dumps({'nomes': digitando})}\n\n".encode())
                    self.wfile.flush()
                if msgs or eventos:
                    self.wfile.flush()
                    continue
                if time.monotonic() - ping > 15:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    ping = time.monotonic()
                # Acorda a tempo de apagar o "digitando" que expira.
                exp = proxima_expiracao(sala)
                with NOVA:
                    NOVA.wait(15 if exp is None else max(0.2, min(15, exp + 0.05)))
        finally:
            ESPERAS.release()


    # presença fina: digitando e leituras

    def marcar_digitando(self, _q: dict) -> None:
        c = self._corpo()
        sala = validar_sala(c.get("sala"))
        with conectar() as con:
            nome = self._nome(self._quem(con), c)
        with TRAVA_DIGITANDO:
            nomes = DIGITANDO.setdefault(sala, {})
            if c.get("parou"):
                nomes.pop(nome, None)
            else:
                nomes[nome] = time.monotonic() + DIGITANDO_TTL
        notificar()
        self._vazio()

    def leituras(self, q: dict) -> None:
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            self._quem(con)
            linhas = con.execute("SELECT nome, ultimo_id, quando FROM leitura WHERE sala=? ORDER BY nome", (sala,)).fetchall()
        self._json(200, [{"nome": n, "ultimo_id": u, "quando": iso(t)} for n, u, t in linhas])

    def marcar_leitura(self, _q: dict) -> None:
        c = self._corpo()
        sala = validar_sala(c.get("sala"))
        try:
            ultimo = int(c.get("ultimo_id") or 0)
        except (TypeError, ValueError):
            raise ErroHttp(400, "ultimo_id_invalido", "ultimo_id deve ser inteiro.") from None
        with conectar() as con:
            nome = self._nome(self._quem(con), c)
            maximo = con.execute("SELECT COALESCE(MAX(id),0) FROM msg WHERE sala=?", (sala,)).fetchone()[0]
            mudou = registrar_leitura(con, nome, sala, min(ultimo, maximo))
        if mudou:
            notificar()
        self._vazio()

    # arquivos

    def subir_arquivo(self, q: dict) -> None:
        """Corpo = bytes do arquivo. Nome em `X-Nome` (URL-encoded) ou ?nome=; tipo no Content-Type."""
        bruto = self.headers.get("Content-Length")
        if bruto is None:
            raise ErroHttp(411, "tamanho_obrigatorio", "Content-Length obrigatório.")
        tam = int(bruto)
        if tam <= 0:
            raise ErroHttp(400, "arquivo_vazio", "Arquivo vazio.")
        if tam > ARQUIVO_MAX:
            raise ErroHttp(413, "arquivo_grande", f"Arquivo grande demais (máx. {ARQUIVO_MAX // 1024 // 1024} MB).")
        nome = unquote(self.headers.get("X-Nome") or q.get("nome") or "arquivo")
        nome = re.sub(r'[\x00-\x1f/\\:*?"<>|]', "_", os.path.basename(nome)).strip()[:120] or "arquivo"
        tipo = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if not re.fullmatch(r"[\w.+-]+/[\w.+-]+", tipo):
            tipo = mimetypes.guess_type(nome)[0] or "application/octet-stream"
        with conectar() as con:
            quem = self._quem(con)
        de = self._nome(quem, q)
        espera = ENVIOS.consumir(de)
        if espera:
            raise ErroHttp(429, "limite_excedido", "Devagar: limite de envio atingido.", espera)
        os.makedirs(PASTA_ARQUIVOS, exist_ok=True)
        aid = secrets.token_urlsafe(18)
        destino = os.path.join(PASTA_ARQUIVOS, aid)
        h = hashlib.sha256()
        falta = tam
        with open(destino + ".parcial", "wb") as f:
            while falta:
                bloco = self.rfile.read(min(65536, falta))
                if not bloco:
                    break
                h.update(bloco)
                f.write(bloco)
                falta -= len(bloco)
        if falta:
            os.remove(destino + ".parcial")
            raise ErroHttp(400, "upload_incompleto", "Upload interrompido.")
        os.replace(destino + ".parcial", destino)
        with conectar() as con:
            con.execute("INSERT INTO arquivo VALUES (?,?,?,?,?,?,?,NULL)", (aid, nome, tipo, tam, h.hexdigest(), de, time.time()))
        self._json(201, {"id": aid, "nome": nome, "tipo": tipo, "tamanho": tam, "url": f"/arquivos/{aid}"})

    def baixar_arquivo(self, aid: str, q: dict) -> None:
        with conectar() as con:
            quem = self._quem(con)
            linha = con.execute(
                "SELECT a.nome, a.tipo, a.tamanho, a.de, m.para, m.de FROM arquivo a LEFT JOIN msg m ON m.id = a.msg_id WHERE a.id=?",
                (aid,)).fetchone()
        if not linha:
            raise ErroHttp(404, "arquivo_inexistente", "Arquivo não existe.")
        nome, tipo, tam, dono, para, autor = linha
        # Anexo de mensagem privada segue a mesma regra da mensagem.
        if para and not quem.admin and quem.nome not in (para, autor):
            raise ErroHttp(404, "arquivo_inexistente", "Arquivo não existe.")
        caminho = os.path.join(PASTA_ARQUIVOS, aid)
        if not os.path.isfile(caminho):
            raise ErroHttp(404, "arquivo_inexistente", "Arquivo não existe.")
        exibir = tipo in TIPOS_EXIBIVEIS and q.get("baixar") != "1"
        nome_q = quote(nome)
        self.send_response(200)
        self.send_header("Content-Type", tipo if exibir else "application/octet-stream")
        self.send_header("Content-Length", str(tam))
        self.send_header("Content-Disposition", f"{'inline' if exibir else 'attachment'}; filename*=UTF-8''{nome_q}")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'")
        self.send_header("Cache-Control", "private, max-age=31536000, immutable")
        self.end_headers()
        with open(caminho, "rb") as f:
            while bloco := f.read(65536):
                self.wfile.write(bloco)

    # identidade em ações de equipe: agente/sessão pelo servidor; token de admin pode dizer quem é

    def _nome(self, quem: Quem, pedido: dict) -> str:
        if quem.admin and not quem.via_cookie:
            nome = str(pedido.get("de") or pedido.get("eu") or quem.nome or "").strip()
        else:
            nome = quem.nome or ""
        if not NOME_RE.match(nome):
            raise ErroHttp(400, "nome_invalido", "Diga quem é (de/eu) ou use um token de agente.")
        return nome

    # tarefas

    def tarefas(self, q: dict) -> None:
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            self._quem(con)
            filtro, args = "", []
            if q.get("sprint"):
                filtro, args = " AND sprint_id=?", [int(q["sprint"])]
            linhas = con.execute(
                f"SELECT {COLS_TAREFA} FROM tarefa WHERE sala=?{filtro} ORDER BY atualizado DESC", [sala, *args]
            ).fetchall()
        self._json(200, [tarefa_para_json(r) for r in linhas])

    def criar_tarefa(self, _q: dict) -> None:
        c = self._corpo()
        sala = validar_sala(c.get("sala"))
        titulo = str(c.get("titulo") or "").strip()
        if not 1 <= len(titulo) <= 200:
            raise ErroHttp(400, "titulo_invalido", "Título da tarefa: 1–200 caracteres.")
        status = c.get("status") or "a_fazer"
        if status not in STATUS_TAREFA:
            raise ErroHttp(400, "status_invalido", f"Status deve ser um de {', '.join(STATUS_TAREFA)}.")
        resp = c.get("responsavel") or None
        if resp is not None and not NOME_RE.match(str(resp)):
            raise ErroHttp(400, "responsavel_invalido", "Responsável inválido.")
        with conectar() as con:
            por = self._nome(self._quem(con), c)
            agora = time.time()
            cur = con.execute(
                f"INSERT INTO tarefa ({COLS_TAREFA.replace('id, ', '', 1)}) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (sala, titulo, c.get("descricao"), status, resp, c.get("sprint_id"), c.get("msg_id"), por, agora, agora, None),
            )
            tid = cur.lastrowid
            mensagem_sistema(con, sala, f"📋 **{por}** criou a tarefa **#{tid}** {titulo}" + (f" → @{resp}" if resp else ""))
            registrar_evento(con, "tarefa", sala, tid)
            linha = con.execute(f"SELECT {COLS_TAREFA} FROM tarefa WHERE id=?", (tid,)).fetchone()
        notificar()
        self._json(201, tarefa_para_json(linha))

    def alterar_tarefa(self, tid: int) -> None:
        c = self._corpo()
        with conectar() as con:
            quem = self._quem(con)
            atual = con.execute(f"SELECT {COLS_TAREFA} FROM tarefa WHERE id=?", (tid,)).fetchone()
            if not atual:
                raise ErroHttp(404, "tarefa_inexistente", "Tarefa não existe.")
            t = tarefa_para_json(atual)
            quem_nome = self._nome(quem, c)
            mudancas: dict = {}
            for campo in ("titulo", "descricao", "status", "responsavel", "sprint_id"):
                if campo in c:
                    mudancas[campo] = c[campo]
            if "status" in mudancas and mudancas["status"] not in STATUS_TAREFA:
                raise ErroHttp(400, "status_invalido", f"Status deve ser um de {', '.join(STATUS_TAREFA)}.")
            if mudancas.get("responsavel") and not NOME_RE.match(str(mudancas["responsavel"])):
                raise ErroHttp(400, "responsavel_invalido", "Responsável inválido.")
            if not mudancas:
                return self._json(200, t)
            sets = ", ".join(f"{k}=?" for k in mudancas)
            con.execute(f"UPDATE tarefa SET {sets}, atualizado=? WHERE id=?", [*mudancas.values(), time.time(), tid])
            novo = mudancas.get("status")
            if novo and novo != t["status"]:
                rotulo = {"a_fazer": "voltou para a fazer", "fazendo": "pegou", "revisao": "mandou para revisão", "feito": "concluiu"}[novo]
                mensagem_sistema(con, t["sala"], f"{'✅' if novo == 'feito' else '🔁'} **{quem_nome}** {rotulo} **#{tid}** {t['titulo']}")
            registrar_evento(con, "tarefa", t["sala"], tid)
            linha = con.execute(f"SELECT {COLS_TAREFA} FROM tarefa WHERE id=?", (tid,)).fetchone()
        notificar()
        self._json(200, tarefa_para_json(linha))

    def apagar_tarefa(self, tid: int) -> None:
        with conectar() as con:
            quem = self._quem(con)
            linha = con.execute("SELECT sala, criada_por FROM tarefa WHERE id=?", (tid,)).fetchone()
            if not linha:
                raise ErroHttp(404, "tarefa_inexistente", "Tarefa não existe.")
            if not (quem.admin or quem.nome == linha[1]):
                raise ErroHttp(403, "proibido", "Só quem criou ou o admin apagam.")
            con.execute("DELETE FROM tarefa WHERE id=?", (tid,))
            registrar_evento(con, "tarefa", linha[0], tid)
        notificar()
        self._vazio()

    # sprints

    def sprints(self, q: dict) -> None:
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            self._quem(con)
            linhas = con.execute(
                """SELECT s.id, s.nome, s.objetivo, s.inicio, s.fim, s.ativa,
                          COUNT(t.id), SUM(t.status='feito')
                   FROM sprint s LEFT JOIN tarefa t ON t.sprint_id = s.id
                   WHERE s.sala=? GROUP BY s.id ORDER BY s.inicio DESC""", (sala,)
            ).fetchall()
        self._json(200, [
            {"id": i, "nome": n, "objetivo": o, "inicio_em": iso(ini), "fim_em": iso(f) if f else None,
             "ativa": bool(a), "total": tot, "feitas": fe or 0}
            for i, n, o, ini, f, a, tot, fe in linhas
        ])

    def criar_sprint(self, _q: dict) -> None:
        c = self._corpo()
        sala = validar_sala(c.get("sala"))
        nome = str(c.get("nome") or "").strip()
        if not 1 <= len(nome) <= 80:
            raise ErroHttp(400, "nome_invalido", "Nome da sprint: 1–80 caracteres.")
        dias = float(c.get("dias") or 7)
        with conectar() as con:
            por = self._nome(self._quem(con), c)
            agora = time.time()
            con.execute("UPDATE sprint SET ativa=0 WHERE sala=?", (sala,))
            cur = con.execute("INSERT INTO sprint (sala, nome, objetivo, inicio, fim, ativa) VALUES (?,?,?,?,?,1)",
                              (sala, nome, c.get("objetivo"), agora, agora + dias * 86400))
            mensagem_sistema(con, sala, f"🏁 **{por}** abriu a sprint **{nome}** ({int(dias)} dias)" + (f": {c['objetivo']}" if c.get("objetivo") else ""))
            registrar_evento(con, "tarefa", sala, 0)
        notificar()
        self._json(201, {"id": cur.lastrowid})

    def alterar_sprint(self, sid: int) -> None:
        c = self._corpo()
        with conectar() as con:
            self._quem(con)
            linha = con.execute("SELECT sala FROM sprint WHERE id=?", (sid,)).fetchone()
            if not linha:
                raise ErroHttp(404, "sprint_inexistente", "Sprint não existe.")
            for campo in ("nome", "objetivo", "ativa"):
                if campo in c:
                    con.execute(f"UPDATE sprint SET {campo}=? WHERE id=?", (c[campo], sid))
            registrar_evento(con, "tarefa", linha[0], 0)
        notificar()
        self._vazio()

    # reuniões

    def _reuniao(self, con: sqlite3.Connection, rid: int) -> dict:
        linha = con.execute(f"SELECT {COLS_REUNIAO} FROM reuniao WHERE id=?", (rid,)).fetchone()
        if not linha:
            raise ErroHttp(404, "reuniao_inexistente", "Reunião não existe.")
        r = reuniao_para_json(linha)
        # Tempo esgotado: para de dar a vez e pede a ata.
        if r["estado"] == "aberta" and r["limite_em"] and time.time() > linha[11]:
            con.execute("UPDATE reuniao SET estado='ata' WHERE id=?", (rid,))
            mensagem_sistema(con, r["canal"], f"⏰ Tempo da reunião **#{rid}** esgotado. Falta a ata (encerrar com decisões e ações).")
            evento_reuniao(con, r)
            notificar()
            r["estado"], r["vez"], r["item_atual"] = "ata", None, None
        return r

    def reunioes(self, q: dict) -> None:
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            self._quem(con)
            ids = [i for (i,) in con.execute(
                "SELECT id FROM reuniao WHERE sala=? OR canal=? ORDER BY id DESC LIMIT 20", (sala, sala))]
            lista = [self._reuniao(con, i) for i in ids]
        self._json(200, lista)

    def ver_reuniao(self, rid: int) -> None:
        with conectar() as con:
            self._quem(con)
            r = self._reuniao(con, rid)
        self._json(200, r)

    def criar_reuniao(self, _q: dict) -> None:
        c = self._corpo()
        sala = validar_sala(c.get("sala"))
        formato = c.get("formato") or "livre"
        if formato not in FORMATOS:
            raise ErroHttp(400, "formato_invalido", f"Formato deve ser um de {', '.join(FORMATOS)}.")
        pauta = [str(p).strip() for p in (c.get("pauta") or FORMATOS[formato]) if str(p).strip()][:12]
        parts = [str(p).strip() for p in (c.get("participantes") or []) if str(p).strip()]
        if not parts or not all(NOME_RE.match(p) for p in parts) or len(parts) > 12:
            raise ErroHttp(400, "participantes_invalidos", "Informe de 1 a 12 participantes válidos.")
        titulo = str(c.get("titulo") or formato.capitalize()).strip()[:120]
        minutos = float(c.get("minutos") or 0)
        with conectar() as con:
            por = self._nome(self._quem(con), c)
            if "." in sala and sala.split(".", 1)[1].startswith("reuniao-"):
                raise ErroHttp(400, "sala_invalida", "Abra a reunião na sala principal, não no canal de outra reunião.")
            if con.execute("SELECT 1 FROM reuniao WHERE sala=? AND estado IN ('aberta','ata')", (sala,)).fetchone():
                raise ErroHttp(409, "reuniao_em_andamento", "Já existe uma reunião em andamento nesta sala.")
            agora = time.time()
            cur = con.execute(
                f"INSERT INTO reuniao ({COLS_REUNIAO.replace('id, ', '', 1)}) VALUES (?,?,?,?,?,0,0,1,'aberta',?,?,NULL,?,NULL)",
                (sala, titulo, formato, json.dumps(pauta, ensure_ascii=False), json.dumps(parts), agora,
                 agora + minutos * 60 if minutos > 0 else None, por),
            )
            rid = cur.lastrowid
            canal = f"{sala}.reuniao-{rid}"
            con.execute("UPDATE reuniao SET canal=? WHERE id=?", (canal, rid))
            itens = "\n".join(f"{n}. {p}" for n, p in enumerate(pauta, 1))
            # Sala principal: só o convite. A conversa da reunião acontece no canal dela.
            mensagem_sistema(con, sala,
                f"🗓 **{por}** abriu a reunião **#{rid} {titulo}** ({formato}" + (f", {int(minutos)} min" if minutos > 0 else "") + ") "
                f"com {', '.join('@' + p for p in parts)} → canal **#{canal}**")
            mensagem_sistema(con, canal,
                f"🗓 **Reunião #{rid} {titulo}** ({formato})\n\n**Pauta**\n{itens}\n\n**Ordem**: {', '.join('@' + p for p in parts)}\n\n"
                f"➡️ Vez de @{parts[0]}: *{pauta[0]}*")
            registrar_evento(con, "reuniao", sala, rid)
            registrar_evento(con, "reuniao", canal, rid)
            r = self._reuniao(con, rid)
        notificar()
        self._json(201, r)

    def aguardar_vez(self, rid: int, q: dict) -> None:
        """Espera longa até ser a vez de `eu` (ou a reunião sair de 'aberta')."""
        espera = min(max(float(q.get("espera", 0) or 0), 0), ESPERA_MAX)
        with conectar() as con:
            quem = self._quem(con)
        eu = self._nome(quem, q)
        if espera and not ESPERAS.acquire(blocking=False):
            raise ErroHttp(503, "ocupado", "Muitas esperas abertas; tente de novo.", 2)
        try:
            limite = time.monotonic() + espera
            while True:
                with conectar() as con:
                    r = self._reuniao(con, rid)
                pronto = r["estado"] != "aberta" or r["vez"] == eu
                restante = limite - time.monotonic()
                if pronto or restante <= 0:
                    break
                with NOVA:
                    NOVA.wait(min(restante, 5))
        finally:
            if espera:
                ESPERAS.release()
        r["sua_vez"] = r["estado"] == "aberta" and r["vez"] == eu
        self._json(200, r)

    def passar_vez(self, rid: int) -> None:
        c = self._corpo() if self.headers.get("Content-Length") not in (None, "0") else {}
        with conectar() as con:
            quem = self._quem(con)
            eu = self._nome(quem, c)
            r = self._reuniao(con, rid)
            if r["estado"] != "aberta":
                raise ErroHttp(409, "reuniao_fechada", "A reunião não está dando a vez.")
            if r["vez"] != eu and not quem.admin and eu != r["criada_por"]:
                raise ErroHttp(403, "nao_e_sua_vez", f"Agora é a vez de {r['vez']}.")
            parts, pauta = r["participantes"], r["pauta"]
            vez, item, rodada = parts.index(r["vez"]) + 1, r["item"], r["rodada"]
            if vez >= len(parts):
                vez, item = 0, item + 1
            if item >= len(pauta):
                con.execute("UPDATE reuniao SET estado='ata', vez=0, item=? WHERE id=?", (item, rid))
                mensagem_sistema(con, r["canal"], f"✔️ Pauta da reunião **#{rid}** concluída. Falta a ata: decisões e ações (`encerrar`).")
            else:
                con.execute("UPDATE reuniao SET vez=?, item=?, rodada=? WHERE id=?", (vez, item, rodada, rid))
                novo_item = " (próximo item)" if item != r["item"] else ""
                mensagem_sistema(con, r["canal"], f"➡️ Vez de @{parts[vez]}{novo_item}: *{pauta[item]}*")
            evento_reuniao(con, r)
            r = self._reuniao(con, rid)
        notificar()
        self._json(200, r)

    def encerrar_reuniao(self, rid: int) -> None:
        c = self._corpo()
        ata = str(c.get("ata") or "").strip()
        if not ata:
            raise ErroHttp(400, "ata_vazia", "A ata é obrigatória (decisões em texto).")
        acoes = c.get("acoes") or []
        if not isinstance(acoes, list) or len(acoes) > 30:
            raise ErroHttp(400, "acoes_invalidas", "acoes deve ser uma lista de até 30 {titulo, responsavel}.")
        with conectar() as con:
            quem = self._quem(con)
            eu = self._nome(quem, c)
            r = self._reuniao(con, rid)
            if r["estado"] == "encerrada":
                raise ErroHttp(409, "reuniao_fechada", "Reunião já encerrada.")
            if eu not in r["participantes"] and eu != r["criada_por"] and not quem.admin:
                raise ErroHttp(403, "proibido", "Só participantes encerram a reunião.")
            criadas = []
            corpo_ata = f"📝 **Ata da reunião #{rid} {r['titulo']}** (por {eu})\n\n{ata}"
            if r["canal"] != r["sala"]:
                mensagem_sistema(con, r["canal"], corpo_ata + "\n\n_Reunião encerrada._")
            msg_id = mensagem_sistema(con, r["sala"], corpo_ata)
            agora = time.time()
            sprint = con.execute("SELECT id FROM sprint WHERE sala=? AND ativa=1", (r["sala"],)).fetchone()
            for a in acoes:
                titulo = str((a or {}).get("titulo") or "").strip()[:200]
                resp = (a or {}).get("responsavel") or None
                if not titulo or (resp and not NOME_RE.match(str(resp))):
                    continue
                cur = con.execute(
                    f"INSERT INTO tarefa ({COLS_TAREFA.replace('id, ', '', 1)}) VALUES (?,?,?,'a_fazer',?,?,?,?,?,?,NULL)",
                    (r["sala"], titulo, f"Da reunião #{rid}", resp, sprint[0] if sprint else None, msg_id, eu, agora, agora),
                )
                criadas.append((cur.lastrowid, titulo, resp))
            if criadas:
                linhas = "\n".join(f"- **#{i}** {t}" + (f" → @{p}" if p else "") for i, t, p in criadas)
                mensagem_sistema(con, r["sala"], f"📋 Ações da reunião #{rid} viraram tarefas:\n{linhas}")
            con.execute("UPDATE reuniao SET estado='encerrada', ata=? WHERE id=?", (ata, rid))
            evento_reuniao(con, r)
            registrar_evento(con, "tarefa", r["sala"], 0)
            r = self._reuniao(con, rid)
        notificar()
        r["tarefas_criadas"] = [i for i, _, _ in criadas]
        self._json(200, r)

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
                apagar_arquivos(con, "msg_id IS NULL AND criado<?", [time.time() - 86400])  # upload nunca anexado
                if RETENCAO_DIAS > 0:
                    limite = time.time() - RETENCAO_DIAS * 86400
                    apagar_arquivos(con, "msg_id IN (SELECT id FROM msg WHERE criado<?)", [limite])
                    con.execute("DELETE FROM msg WHERE criado<?", (limite,))
        except sqlite3.Error as e:
            print(f"faxina falhou: {e}", flush=True)
        time.sleep(3600)


class Servidor(ThreadingHTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--porta", type=int, default=8790)
    ap.add_argument("--tls-cert", help="certificado PEM (ex.: de `tailscale cert <maquina>.ts.net`)")
    ap.add_argument("--tls-key", help="chave PEM do certificado")
    ap.add_argument("--porta-tls", type=int, help="com certificado: HTTPS nesta porta e HTTP segue em --porta (mesmo processo)")
    a = ap.parse_args()
    if a.host != "127.0.0.1" and not TOKEN_ADMIN:
        raise SystemExit("defina RELAY_TOKEN para expor fora do localhost")
    migrar()
    threading.Thread(target=faxina, daemon=True).start()
    def com_tls(srv: Servidor) -> Servidor:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(a.tls_cert, a.tls_key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        return srv

    if bool(a.tls_cert) != bool(a.tls_key):
        raise SystemExit("--tls-cert e --tls-key vão juntos")
    servidor = Servidor((a.host, a.porta), Handler)
    if a.tls_cert and a.porta_tls:
        # HTTP (compatibilidade com clientes antigos) + HTTPS no mesmo processo: o tempo real é compartilhado.
        seguro = com_tls(Servidor((a.host, a.porta_tls), Handler))
        threading.Thread(target=seguro.serve_forever, daemon=True).start()
        TLS_PORTAS.add(a.porta_tls)
        print(f"relay v2 em http://{a.host}:{a.porta} e https://{a.host}:{a.porta_tls}", flush=True)
    elif a.tls_cert:
        servidor = com_tls(servidor)
        TLS_PORTAS.add(a.porta)
        print(f"relay v2 em https://{a.host}:{a.porta}", flush=True)
    else:
        print(f"relay v2 em http://{a.host}:{a.porta}", flush=True)
    servidor.serve_forever()
