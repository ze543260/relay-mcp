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
import base64
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
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

import relay_fluxos

TOKEN_ADMIN = os.environ.get("RELAY_TOKEN", "")
TLS_PORTAS: set[int] = set()  # portas servidas com TLS (cookie Secure só nelas)
RAIZ = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(RAIZ, "frontend", "web", "dist")
PAGINA_LEGADA = os.path.join(RAIZ, "frontend", "dashboard.html")
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
APELIDO_RE = re.compile(r"^[\w][\w .'-]{0,23}$")
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
    # 8: apelido de exibição (o nome técnico segue sendo a identidade)
    """CREATE TABLE IF NOT EXISTS apelido (
         nome TEXT PRIMARY KEY, apelido TEXT NOT NULL UNIQUE COLLATE NOCASE, definido_por TEXT NOT NULL, quando REAL NOT NULL);""",
    # 9: edição de mensagem (quando foi editada; o texto antigo não é guardado)
    "ALTER TABLE msg ADD COLUMN editado REAL;",
    # 10: memória da equipe (docs/PLANO-MEMORIA.md): fatos com origem; nada se apaga, o novo supera o antigo.
    # O índice FTS é mantido pelo código (migrar() divide por ";", então sem triggers). É external content:
    # quem apagar ou editar texto de um fato (ex.: retenção) tem que tirar a versão antiga do índice antes, com
    # INSERT INTO fato_busca(fato_busca, rowid, sujeito, predicado, objeto) VALUES('delete', id, <valores antigos>),
    # senão a busca devolve lixo. Hoje fato nunca é apagado nem tem o texto editado.
    """CREATE TABLE IF NOT EXISTS fato (
         id INTEGER PRIMARY KEY, sala TEXT NOT NULL, sujeito TEXT NOT NULL, predicado TEXT NOT NULL, objeto TEXT NOT NULL,
         origem_tipo TEXT NOT NULL, origem_id TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'vigente',
         superado_por INTEGER REFERENCES fato(id), autor TEXT NOT NULL, confirmado_por TEXT, criado REAL NOT NULL);
       CREATE INDEX IF NOT EXISTS fato_vigente ON fato(sala, sujeito COLLATE NOCASE) WHERE estado='vigente';
       CREATE INDEX IF NOT EXISTS fato_origem ON fato(origem_tipo, origem_id);
       CREATE VIRTUAL TABLE IF NOT EXISTS fato_busca USING fts5(
         sujeito, predicado, objeto, content='fato', content_rowid='id', tokenize='unicode61 remove_diacritics 2');""",
    # 11: candidato vindo de ata guarda qual fato pretende superar (só vale quando um humano confirma)
    """ALTER TABLE fato ADD COLUMN supera INTEGER REFERENCES fato(id);
       CREATE INDEX IF NOT EXISTS fato_candidato ON fato(sala) WHERE estado='candidato';""",
    # 12: kanban fase 1 (docs/PLANO-KANBAN.md): prioridade, estimativa, ordem, etiquetas, checklist e
    # histórico de atividade (quem mudou o quê, para auditoria)
    """ALTER TABLE tarefa ADD COLUMN prioridade TEXT NOT NULL DEFAULT 'nenhuma';
       ALTER TABLE tarefa ADD COLUMN estimativa INTEGER;
       ALTER TABLE tarefa ADD COLUMN ordem REAL;
       CREATE TABLE IF NOT EXISTS etiqueta (
         id INTEGER PRIMARY KEY, sala TEXT NOT NULL, nome TEXT NOT NULL COLLATE NOCASE, cor INTEGER NOT NULL,
         UNIQUE (sala, nome));
       CREATE TABLE IF NOT EXISTS tarefa_etiqueta (
         tarefa_id INTEGER NOT NULL, etiqueta_id INTEGER NOT NULL, PRIMARY KEY (tarefa_id, etiqueta_id));
       CREATE TABLE IF NOT EXISTS checklist (
         id INTEGER PRIMARY KEY, tarefa_id INTEGER NOT NULL, texto TEXT NOT NULL,
         feito INTEGER NOT NULL DEFAULT 0, ordem REAL NOT NULL);
       CREATE INDEX IF NOT EXISTS checklist_tarefa ON checklist(tarefa_id, ordem);
       CREATE TABLE IF NOT EXISTS atividade (
         id INTEGER PRIMARY KEY, tarefa_id INTEGER NOT NULL, de TEXT NOT NULL, campo TEXT NOT NULL,
         antes TEXT, depois TEXT, quando REAL NOT NULL);
       CREATE INDEX IF NOT EXISTS atividade_tarefa ON atividade(tarefa_id, id);""",
    # 13: artefatos versionados (docs/PLANO-ARTEFATOS.md); nada se apaga, cada edição é uma versão nova.
    """CREATE TABLE IF NOT EXISTS artefato (
         id INTEGER PRIMARY KEY, sala TEXT NOT NULL, titulo TEXT NOT NULL, tipo TEXT NOT NULL,
         versao_atual INTEGER NOT NULL DEFAULT 1, estado TEXT NOT NULL DEFAULT 'rascunho',
         criado_por TEXT NOT NULL, criado REAL NOT NULL, atualizado REAL NOT NULL, msg_id INTEGER);
       CREATE INDEX IF NOT EXISTS artefato_sala ON artefato(sala, atualizado);
       CREATE TABLE IF NOT EXISTS artefato_versao (
         artefato_id INTEGER NOT NULL, versao INTEGER NOT NULL, conteudo TEXT NOT NULL, resumo TEXT,
         autor TEXT NOT NULL, criado REAL NOT NULL, PRIMARY KEY (artefato_id, versao));""",
    # 14: fato gerado pela aprovação do artefato (a próxima aprovação supera este; arquivar encerra)
    "ALTER TABLE artefato ADD COLUMN fato_id INTEGER;",
    # 15: memória fase 6 (docs/PLANO-MEMORIA.md): nomes normalizados e aliases, resolvidos na leitura.
    # O backfill das colunas *_norm roda no migrar() (é Python, não SQL).
    """ALTER TABLE fato ADD COLUMN sujeito_norm TEXT;
       ALTER TABLE fato ADD COLUMN objeto_norm TEXT;
       CREATE INDEX IF NOT EXISTS fato_sujeito_norm ON fato(sala, sujeito_norm) WHERE estado='vigente';
       CREATE INDEX IF NOT EXISTS fato_objeto_norm ON fato(sala, objeto_norm) WHERE estado='vigente';
       CREATE TABLE IF NOT EXISTS alias (
         sala TEXT NOT NULL, nome TEXT NOT NULL, nome_norm TEXT NOT NULL, canonico TEXT NOT NULL,
         canonico_norm TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'vigente', criado_por TEXT NOT NULL,
         confirmado_por TEXT, origem_tipo TEXT, origem_id TEXT, criado REAL NOT NULL,
         PRIMARY KEY (sala, nome_norm));""",
    # 16: perfil (docs/PLANO-PERFIL.md): dono humano do agente e ficha de persona (editável só pelo dono).
    """ALTER TABLE agente ADD COLUMN dono TEXT;
       CREATE TABLE IF NOT EXISTS persona (
         nome TEXT PRIMARY KEY, equipe TEXT, papel TEXT, foco TEXT, tom TEXT, limites TEXT,
         editado_por TEXT NOT NULL, quando REAL NOT NULL);""",
    # 17: busca nas mensagens (docs/PLANO-WEB-UX.md, fase 2). FTS external content mantido pelo código, como o
    # fato_busca: inserir, editar e apagar mensagem atualizam o índice; a retenção faz 'rebuild' depois de apagar.
    """CREATE VIRTUAL TABLE IF NOT EXISTS msg_busca USING fts5(
         texto, content='msg', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
       INSERT INTO msg_busca(msg_busca) VALUES('rebuild');""",
    # 18: workflows (docs/PLANO-FLUXOS.md): catálogo imutável por nome@versão (com hash) e pedidos entre agentes.
    # O relay só guarda e repassa: quem aprova e executa é o executor local de cada dono.
    """CREATE TABLE IF NOT EXISTS fluxo (
         sala TEXT NOT NULL, nome TEXT NOT NULL, versao INTEGER NOT NULL, sha256 TEXT NOT NULL,
         conteudo TEXT NOT NULL, layout TEXT, descricao TEXT, pior_caso INTEGER NOT NULL,
         publicado_por TEXT NOT NULL, criado REAL NOT NULL, PRIMARY KEY (sala, nome, versao));
       CREATE TABLE IF NOT EXISTS fluxo_pedido (
         id INTEGER PRIMARY KEY, sala TEXT NOT NULL, de TEXT NOT NULL, agente TEXT NOT NULL, nome TEXT NOT NULL,
         versao INTEGER NOT NULL, expect_sha256 TEXT, params TEXT NOT NULL, cadeia TEXT NOT NULL,
         correlation_id TEXT NOT NULL UNIQUE, estado TEXT NOT NULL DEFAULT 'pendente', resultado TEXT, motivo TEXT,
         msg_id INTEGER, criado REAL NOT NULL, atualizado REAL NOT NULL, expira REAL NOT NULL);
       CREATE INDEX IF NOT EXISTS fluxo_pedido_agente ON fluxo_pedido(agente, estado, id);""",
    # 19: foto de perfil. Bitmap pequeno no próprio banco; `versao` vai na URL pra o cliente cachear sem medo.
    """CREATE TABLE IF NOT EXISTS foto (
         nome TEXT PRIMARY KEY, tipo TEXT NOT NULL, dados BLOB NOT NULL, versao INTEGER NOT NULL,
         editado_por TEXT NOT NULL, quando REAL NOT NULL);""",
]

STATUS_TAREFA = ("a_fazer", "fazendo", "revisao", "feito")
PRIORIDADES = ("urgente", "alta", "media", "baixa", "nenhuma")   # na ordem da fila
ESTIMATIVAS = (1, 2, 3, 5, 8)                                     # pontos (Fibonacci)
CORES_ETIQUETA = 8          # índice na paleta do web (tokens --agente-0..7)
DESCRICAO_MAX = 20_000
MAX_ETIQUETAS, MAX_CHECKLIST = 10, 50
ORIGENS_FATO = ("msg", "ata", "tarefa", "arquivo")
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
        # Fatos de antes da migração 15 (ou gravados por código antigo) ganham os nomes normalizados.
        pendentes = con.execute("SELECT id, sujeito, objeto FROM fato WHERE sujeito_norm IS NULL OR objeto_norm IS NULL").fetchall()
        con.executemany("UPDATE fato SET sujeito_norm=?, objeto_norm=? WHERE id=?",
                        [(normalizar(s), normalizar(o), i) for i, s, o in pendentes])
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
    indexar_msg(con, cur.lastrowid, texto)
    return cur.lastrowid


def indexar_msg(con: sqlite3.Connection, mid: int, texto: str, antigo: str | None = None) -> None:
    """Mantém msg_busca. `antigo` = texto que estava indexado (edição ou apagamento), removido antes."""
    if antigo is not None:
        con.execute("INSERT INTO msg_busca(msg_busca, rowid, texto) VALUES('delete', ?, ?)", (mid, antigo))
    if texto:
        con.execute("INSERT INTO msg_busca(rowid, texto) VALUES (?, ?)", (mid, texto))


def tarefa_para_json(r: tuple) -> dict:
    i, sala, titulo, desc, status, resp, sprint, msg, por, criado, atual, prazo, prioridade, estimativa, ordem = r
    return {"id": i, "sala": sala, "titulo": titulo, "descricao": desc, "status": status, "responsavel": resp,
            "sprint_id": sprint, "msg_id": msg, "criada_por": por, "criado_em": iso(criado),
            "atualizado_em": iso(atual), "prazo": iso(prazo) if prazo else None,
            "prioridade": prioridade, "estimativa": estimativa, "ordem": ordem}


def com_extras(con: sqlite3.Connection, tarefas: list[dict]) -> list[dict]:
    """Etiquetas e progresso do checklist de várias tarefas, em duas consultas."""
    if not tarefas:
        return tarefas
    ids = [t["id"] for t in tarefas]
    marcas = ",".join("?" * len(ids))
    etiquetas: dict[int, list[dict]] = {}
    for tid, eid, nome, cor in con.execute(
            f"SELECT te.tarefa_id, e.id, e.nome, e.cor FROM tarefa_etiqueta te JOIN etiqueta e ON e.id=te.etiqueta_id "
            f"WHERE te.tarefa_id IN ({marcas}) ORDER BY e.nome", ids):
        etiquetas.setdefault(tid, []).append({"id": eid, "nome": nome, "cor": cor})
    progresso = {tid: (feitos, total) for tid, feitos, total in con.execute(
        f"SELECT tarefa_id, SUM(feito), COUNT(*) FROM checklist WHERE tarefa_id IN ({marcas}) GROUP BY tarefa_id", ids)}
    for t in tarefas:
        t["etiquetas"] = etiquetas.get(t["id"], [])
        feitos, total = progresso.get(t["id"], (0, 0))
        t["checklist"] = {"feitos": feitos, "total": total}
    return tarefas


def registrar_atividade(con: sqlite3.Connection, tid: int, de: str, campo: str, antes: object, depois: object) -> None:
    texto = lambda v: None if v is None else (v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))  # noqa: E731
    con.execute("INSERT INTO atividade (tarefa_id, de, campo, antes, depois, quando) VALUES (?,?,?,?,?,?)",
                (tid, de, campo, texto(antes), texto(depois), time.time()))


def cor_padrao(nome: str) -> int:
    """Cor estável por nome, para a mesma etiqueta ter a mesma cor em qualquer sala."""
    return int(hashlib.sha256(nome.lower().encode()).hexdigest(), 16) % CORES_ETIQUETA


def validar_campos_tarefa(c: dict) -> dict:
    """Valida os campos editáveis presentes em `c` e devolve-os normalizados (prazo em epoch)."""
    v: dict = {}
    if "titulo" in c:
        titulo = " ".join(str(c["titulo"] or "").split())
        if not 1 <= len(titulo) <= 200:
            raise ErroHttp(400, "titulo_invalido", "Título da tarefa: 1–200 caracteres.")
        v["titulo"] = titulo
    if "descricao" in c:
        desc = c["descricao"]
        if desc is not None and (not isinstance(desc, str) or len(desc) > DESCRICAO_MAX):
            raise ErroHttp(400, "descricao_invalida", "Descrição: texto de até 20 KB (Markdown).")
        if desc and CREDENCIAL_RE.search(desc):
            raise ErroHttp(422, "credencial_detectada", "A descrição parece conter uma credencial. Não foi salva.")
        v["descricao"] = desc or None
    if "status" in c:
        if c["status"] not in STATUS_TAREFA:
            raise ErroHttp(400, "status_invalido", f"Status deve ser um de {', '.join(STATUS_TAREFA)}.")
        v["status"] = c["status"]
    if "responsavel" in c:
        if c["responsavel"] and not NOME_RE.match(str(c["responsavel"])):
            raise ErroHttp(400, "responsavel_invalido", "Responsável inválido.")
        v["responsavel"] = c["responsavel"] or None
    if "prioridade" in c:
        if c["prioridade"] not in PRIORIDADES:
            raise ErroHttp(400, "prioridade_invalida", f"Prioridade deve ser uma de {', '.join(PRIORIDADES)}.")
        v["prioridade"] = c["prioridade"]
    if "estimativa" in c:
        if c["estimativa"] is not None and c["estimativa"] not in ESTIMATIVAS:
            raise ErroHttp(400, "estimativa_invalida", f"Estimativa em pontos: {', '.join(map(str, ESTIMATIVAS))} ou null.")
        v["estimativa"] = c["estimativa"]
    if "prazo" in c:
        prazo = c["prazo"]
        if prazo is None:
            v["prazo"] = None
        else:
            try:
                v["prazo"] = datetime.fromisoformat(str(prazo).replace("Z", "+00:00")).timestamp()
            except ValueError:
                raise ErroHttp(400, "prazo_invalido", "Prazo: data ISO 8601 (ex.: 2026-11-05 ou 2026-11-05T18:00:00Z) ou null.") from None
    if "ordem" in c:
        if c["ordem"] is not None and (isinstance(c["ordem"], bool) or not isinstance(c["ordem"], (int, float))):
            raise ErroHttp(400, "ordem_invalida", "ordem deve ser um número.")
        v["ordem"] = c["ordem"]
    if "sprint_id" in c:
        v["sprint_id"] = c["sprint_id"]
    return v


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


COLS_FATO = ("id, sala, sujeito, predicado, objeto, origem_tipo, origem_id, estado, superado_por, autor, "
             "confirmado_por, criado, supera")
MAX_FATOS_ATA = 20


def fato_para_json(r: tuple) -> dict:
    i, sala, suj, pred, obj, otipo, oid, estado, superado_por, autor, confirmado_por, criado, supera = r
    return {"id": i, "sala": sala, "sujeito": suj, "predicado": pred, "objeto": obj,
            "origem": {"tipo": otipo, "id": oid}, "estado": estado, "supera": supera, "superado_por": superado_por,
            "autor": autor, "confirmado_por": confirmado_por, "criado_em": iso(criado)}


def campos_fato(d: dict) -> dict:
    """sujeito/predicado/objeto normalizados e validados (tamanho e filtro de credencial)."""
    campos = {}
    for campo, maximo in (("sujeito", 120), ("predicado", 120), ("objeto", 500)):
        valor = " ".join(str(d.get(campo) or "").split())
        if not 1 <= len(valor) <= maximo:
            raise ErroHttp(400, f"{campo}_invalido", f"{campo}: 1–{maximo} caracteres.")
        if CREDENCIAL_RE.search(valor):
            raise ErroHttp(422, "credencial_detectada", "O fato parece conter uma credencial. Não foi registrado.")
        campos[campo] = valor
    supera = d.get("supera")
    if supera is not None and (not isinstance(supera, int) or isinstance(supera, bool)):
        raise ErroHttp(400, "supera_invalido", "supera deve ser o id de um fato.")
    campos["supera"] = supera
    return campos


def checar_supera(con: sqlite3.Connection, sala: str, supera: int | None) -> None:
    if supera is None:
        return
    antigo = con.execute("SELECT sala, estado FROM fato WHERE id=?", (supera,)).fetchone()
    if not antigo or antigo[0] != sala:
        raise ErroHttp(400, "supera_inexistente", "O fato a superar não existe nesta sala.")
    if antigo[1] != "vigente":
        raise ErroHttp(409, "fato_nao_vigente", "Esse fato já foi superado; supere a versão vigente.")


def inserir_fato(con: sqlite3.Connection, sala: str, campos: dict, otipo: str, oid: str, estado: str, autor: str) -> int:
    cur = con.execute(
        f"INSERT INTO fato ({COLS_FATO.replace('id, ', '', 1)}) VALUES (?,?,?,?,?,?,?,NULL,?,NULL,?,?)",
        (sala, campos["sujeito"], campos["predicado"], campos["objeto"], otipo, oid, estado, autor, time.time(),
         campos["supera"]),
    )
    con.execute("UPDATE fato SET sujeito_norm=?, objeto_norm=? WHERE id=?",
                (normalizar(campos["sujeito"]), normalizar(campos["objeto"]), cur.lastrowid))
    con.execute("INSERT INTO fato_busca (rowid, sujeito, predicado, objeto) VALUES (?,?,?,?)",
                (cur.lastrowid, campos["sujeito"], campos["predicado"], campos["objeto"]))
    return cur.lastrowid


# --- Memória fase 6: nomes, aliases e grafo ------------------------------------

ALIAS_MAX_SALA = 200
ALIAS_TRAVA_FATOS = 20      # agente juntando num nó com tantos fatos (ou mais) vira candidato
GRAFO_MAX_ARESTAS = 50
ARTIGOS = ("o", "a", "os", "as", "um", "uma")


def normalizar(nome: str) -> str:
    """Chave de comparação de nomes: minúsculas, sem acento, espaços colapsados.
    Única fonte da verdade da normalização (o back novo replica numa função IMMUTABLE do banco).
    Artigo NÃO é tirado: "A Fazer" perderia o sentido; variantes com artigo viram só sugestão de alias."""
    sem_acento = "".join(c for c in unicodedata.normalize("NFD", nome) if unicodedata.category(c) != "Mn")
    return " ".join(sem_acento.lower().split())


def chave_forte(norm: str) -> str:
    """Chave só para SUGERIR aliases (nunca junta sozinha): sem artigo inicial, sufixos comuns, hífens e plural."""
    palavras = norm.split()
    if len(palavras) > 1 and palavras[0] in ARTIGOS:
        palavras = palavras[1:]
    k = re.sub(r"[-_ ](mcp|app|web|server|servidor)$", "", " ".join(palavras))
    k = re.sub(r"[-_\s]+", "", k)
    return k[:-1] if len(k) > 3 and k.endswith("s") else k


def mapa_aliases(con: sqlite3.Connection, sala: str) -> dict[str, str]:
    """nome_norm -> canonico_norm dos aliases vigentes da sala (sempre já a raiz)."""
    return dict(con.execute("SELECT nome_norm, canonico_norm FROM alias WHERE sala=? AND estado='vigente'", (sala,)))


def nomes_do_no(con: sqlite3.Connection, sala: str, raiz: str) -> list[str]:
    """Todas as chaves normalizadas que caem no mesmo nó (a raiz e os aliases vigentes dela)."""
    return [raiz] + [n for (n,) in con.execute(
        "SELECT nome_norm FROM alias WHERE sala=? AND canonico_norm=? AND estado='vigente'", (sala, raiz))]


def montar_grafo(con: sqlite3.Connection, sala: str, centros: set[str], autor: str | None, profundidade: int) -> dict:
    """Busca em largura nos fatos vigentes da sala, nos dois sentidos, a partir dos nós `centros`.
    Com `autor` (centro = agente), os fatos que ele registrou também entram no primeiro nível."""
    aliases = mapa_aliases(con, sala)
    raiz = lambda n: aliases.get(n, n)  # noqa: E731
    fatos = con.execute("SELECT id, sujeito, predicado, objeto, sujeito_norm, objeto_norm, origem_tipo, origem_id, autor, criado "
                        "FROM fato WHERE sala=? AND estado='vigente' ORDER BY criado DESC", (sala,)).fetchall()
    sujeitos = {raiz(f[4]) for f in fatos} | set(aliases.values()) | centros  # o centro é nó mesmo só aparecendo como objeto
    rotulo: dict[str, str] = {}
    for f in reversed(fatos):  # rótulo do nó: o primeiro texto registrado como sujeito
        rotulo.setdefault(raiz(f[4]), f[1])
    arestas, vistos, fronteira, cortado = [], set(), set(centros), False
    visitados = set(centros)
    for nivel in range(profundidade):
        proxima: set[str] = set()
        for f in fatos:
            fid, suj, pred, obj, sn, on, otipo, oid, quem, _ = f
            de, para = raiz(sn), raiz(on)
            toca = de in fronteira or para in fronteira or (nivel == 0 and autor is not None and quem == autor)
            if fid in vistos or not toca:
                continue
            if len(arestas) >= GRAFO_MAX_ARESTAS:
                cortado = True
                break
            vistos.add(fid)
            folha = para not in sujeitos
            arestas.append({"fato": fid, "de": de, "predicado": pred, "para": para if not folha else obj, "folha": folha,
                            "origem": {"tipo": otipo, "id": oid}, "autor": quem})
            for n in ((de,) if folha else (de, para)):
                if n not in visitados:
                    proxima.add(n)
        if cortado:
            break
        visitados |= proxima
        fronteira = proxima
    usados = {a["de"] for a in arestas} | {a["para"] for a in arestas if not a["folha"]} | (centros & sujeitos)
    contagem: dict[str, int] = {}
    for f in fatos:
        for n in {raiz(f[4]), raiz(f[5])}:
            contagem[n] = contagem.get(n, 0) + 1
    por_raiz: dict[str, list[str]] = {}
    for nome, canon in aliases.items():
        por_raiz.setdefault(canon, []).append(nome)
    nos = [{"nome": n, "rotulo": rotulo.get(n, n), "aliases": sorted(por_raiz.get(n, [])), "fatos": contagem.get(n, 0)}
           for n in sorted(usados)]
    return {"nos": nos, "arestas": arestas, "cortado": cortado}


def superar(con: sqlite3.Connection, novo: int, supera: int | None) -> None:
    # Condicional: se outro pedido superou o mesmo fato no meio, a exceção desfaz a transação inteira.
    if supera is not None and con.execute(
            "UPDATE fato SET estado='superado', superado_por=? WHERE id=? AND estado='vigente'", (novo, supera)).rowcount == 0:
        raise ErroHttp(409, "fato_nao_vigente", "Esse fato acabou de ser superado; supere a versão vigente.")


def humano_confirmado(con: sqlite3.Connection, quem: "Quem") -> str | None:
    """Nome de quem é humano com identidade forte: token (ou sessão dele) cujo tipo é 'humano'.
    O token de admin nunca conta, nem a sessão aberta com ele: ali o nome é escolhido livremente."""
    if quem.admin or not quem.nome:
        return None
    linha = con.execute("SELECT 1 FROM agente WHERE nome=? AND tipo='humano' AND revogado IS NULL", (quem.nome,)).fetchone()
    return quem.nome if linha else None


TIPOS_ARTEFATO = ("markdown", "mermaid", "html", "svg")
ARTEFATO_MAX = 200 * 1024
COLS_ARTEFATO = "id, sala, titulo, tipo, versao_atual, estado, criado_por, criado, atualizado, msg_id, fato_id"
ICONE_ARTEFATO = {"markdown": "📄", "mermaid": "🔀", "html": "🖼️", "svg": "✏️"}
VERSOES_MAX = 200
ARTEFATO_TOTAL_MAX = 20 * 1024 * 1024


def titulo_seguro(titulo: str) -> str:
    """Título dentro da mensagem de sistema: sem marcador de cartão, sem menção e sem Markdown."""
    t = titulo.replace("[[", "").replace("]]", "").replace("@", "@\u200b")
    return re.sub(r"([\\`*_~\[\]<>|#])", r"\\\1", t)



def artefato_para_json(r: tuple) -> dict:
    i, sala, titulo, tipo, versao, estado, por, criado, atual, msg, _fato = r
    return {"id": i, "sala": sala, "titulo": titulo, "tipo": tipo, "versao": versao, "estado": estado,
            "criado_por": por, "criado_em": iso(criado), "atualizado_em": iso(atual), "msg_id": msg}


def conteudo_artefato(c: dict) -> tuple[str, str | None]:
    conteudo = c.get("conteudo")
    if not isinstance(conteudo, str) or not conteudo.strip():
        raise ErroHttp(400, "conteudo_invalido", "Mande o conteúdo do artefato.")
    if len(conteudo.encode()) > ARTEFATO_MAX:
        raise ErroHttp(413, "artefato_grande", "Artefato grande demais (máx. 200 KB por versão).")
    if CREDENCIAL_RE.search(conteudo):
        raise ErroHttp(422, "credencial_detectada", "O artefato parece conter uma credencial. Não foi salvo.")
    resumo = " ".join(str(c.get("resumo") or "").split())[:200] or None
    return conteudo, resumo



def consulta_fts(termo: str) -> str:
    """Termo livre -> expressão FTS5 segura: cada palavra entre aspas, com prefixo (`reun` acha `reunião`).
    Palavras de 1 caractere ficam de fora: como prefixo, casariam quase tudo."""
    palavras = [p for p in re.findall(r"\w+", termo) if len(p) >= 2][:8]
    return " ".join(f'"{p}"*' for p in palavras)


COLS_TAREFA = ("id, sala, titulo, descricao, status, responsavel, sprint_id, msg_id, criada_por, criado, atualizado, prazo, "
               "prioridade, estimativa, ordem")
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
FATOS = Balde(capacidade=20, por_segundo=1 / 3)   # rajada de 20, depois 20/min


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

COLUNAS = "id, de, para, texto, criado, client_id, reply_to, editado"


def linha_para_msg(r: tuple) -> dict:
    i, de, para, texto, criado, client_id, reply_to, editado = r
    m = {"id": i, "de": de, "para": para, "texto": texto, "criado": criado, "criado_em": iso(criado)}
    if editado:
        m["editado"] = editado
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


def filtro_visiveis(quem: Quem, eu: str | None, todas: bool, t: str = "") -> tuple[str, list]:
    """Admin com todas=1 vê tudo; os outros veem públicas, as suas e as endereçadas a si. `t`: alias ("m.")."""
    if quem.admin and todas:
        return "1", []
    return f"({t}para IS NULL OR {t}para=? OR {t}de=?)", [eu, eu]


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

    def _corpo(self, maximo: int | None = None) -> dict:
        bruto = self.headers.get("Content-Length")
        if bruto is None:
            raise ErroHttp(411, "tamanho_obrigatorio", "Content-Length obrigatório.")
        try:
            tam = int(bruto)
        except ValueError:
            raise ErroHttp(400, "tamanho_invalido", "Content-Length inválido.") from None
        if tam < 0:
            raise ErroHttp(400, "tamanho_invalido", "Content-Length inválido.")
        if tam > (maximo or TAM_MAX):
            raise ErroHttp(413, "mensagem_grande", f"Pedido grande demais (máx. {(maximo or TAM_MAX) // 1024} KB).")
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
                ("GET", "/mensagens/busca"): self.buscar_mensagens,
                ("GET", "/busca"): self.busca,
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
                ("GET", "/etiquetas"): self.etiquetas,
                ("GET", "/sprints"): self.sprints,
                ("POST", "/sprints"): self.criar_sprint,
                ("GET", "/reunioes"): self.reunioes,
                ("POST", "/reunioes"): self.criar_reuniao,
                ("GET", "/fatos"): self.fatos,
                ("POST", "/fatos"): self.registrar_fato,
                ("GET", "/fatos/candidatos"): self.candidatos,
                ("GET", "/memoria/aliases"): self.aliases,
                ("POST", "/memoria/aliases"): self.criar_alias,
                ("DELETE", "/memoria/aliases"): self.apagar_alias,
                ("POST", "/memoria/aliases/decidir"): self.decidir_alias,
                ("GET", "/memoria/aliases/sugestoes"): self.sugestoes_alias,
                ("GET", "/memoria/grafo"): self.grafo,
                ("GET", "/artefatos"): self.artefatos,
                ("POST", "/artefatos"): self.criar_artefato,
                ("GET", "/fluxos"): self.fluxos,
                ("POST", "/fluxos"): self.publicar_fluxo,
                ("GET", "/fluxos/pedidos"): self.pedidos_fluxo,
                ("POST", "/fluxos/pedidos"): self.pedir_fluxo,
            }
            if (metodo, caminho) in rotas:
                return rotas[(metodo, caminho)](q)
            m = re.fullmatch(r"/mensagens/(\d+)/contexto", caminho)
            if m and metodo == "GET":
                return self.contexto_mensagem(int(m.group(1)), q)
            m = re.fullmatch(r"/mensagens/(\d+)", caminho)
            if m and metodo == "DELETE":
                return self.apagar_mensagem(int(m.group(1)))
            if m and metodo == "PATCH":
                return self.editar_mensagem(int(m.group(1)))
            m = re.fullmatch(r"/agentes/([^/]+)", caminho)
            if m and metodo == "DELETE":
                return self.revogar_agente(unquote(m.group(1)))
            if m and metodo == "GET":
                return self.perfil(unquote(m.group(1)), q)
            m = re.fullmatch(r"/agentes/([^/]+)/(persona|dono)", caminho)
            if m and metodo == "PUT":
                return (self.editar_persona if m.group(2) == "persona" else self.definir_dono)(unquote(m.group(1)))
            m = re.fullmatch(r"/agentes/([^/]+)/foto", caminho)
            if m and metodo in ("GET", "PUT", "DELETE"):
                return {"GET": self.ver_foto, "PUT": self.trocar_foto, "DELETE": self.apagar_foto}[metodo](unquote(m.group(1)))
            m = re.fullmatch(r"/arquivos/([\w-]{16,64})", caminho)
            if m and metodo == "GET":
                return self.baixar_arquivo(m.group(1), q)
            m = re.fullmatch(r"/apelidos/([^/]+)", caminho)
            if m and metodo == "PUT":
                return self.definir_apelido(unquote(m.group(1)))
            m = re.fullmatch(r"/tarefas/(\d+)", caminho)
            if m and metodo == "GET":
                return self.ver_tarefa(int(m.group(1)))
            if m and metodo in ("PATCH", "DELETE"):
                return (self.alterar_tarefa if metodo == "PATCH" else self.apagar_tarefa)(int(m.group(1)))
            m = re.fullmatch(r"/tarefas/(\d+)/checklist(?:/(\d+))?", caminho)
            if m and metodo == "POST" and m.group(2) is None:
                return self.criar_item(int(m.group(1)))
            if m and metodo in ("PATCH", "DELETE") and m.group(2):
                return self.alterar_item(int(m.group(1)), int(m.group(2)), metodo)
            m = re.fullmatch(r"/etiquetas/(\d+)", caminho)
            if m and metodo in ("PATCH", "DELETE"):
                return self.alterar_etiqueta(int(m.group(1)), metodo)
            m = re.fullmatch(r"/fatos/(\d+)(?:/(confirmar|rejeitar))?", caminho)
            if m and metodo == "GET" and m.group(2) is None:
                return self.ver_fato(int(m.group(1)))
            if m and metodo == "POST" and m.group(2):
                return self.decidir_fato(int(m.group(1)), m.group(2))
            m = re.fullmatch(r"/artefatos/(\d+)(?:/(versoes|aprovar|arquivar))?", caminho)
            if m:
                aid, acao = int(m.group(1)), m.group(2)
                if metodo == "GET" and acao is None:
                    return self.ver_artefato(aid, q)
                if metodo == "GET" and acao == "versoes":
                    return self.versoes_artefato(aid)
                if metodo == "PUT" and acao is None:
                    return self.atualizar_artefato(aid)
                if metodo == "POST" and acao in ("aprovar", "arquivar"):
                    return self.decidir_artefato(aid, acao)
            m = re.fullmatch(r"/fluxos/pedidos/(\d+)(?:/(estado))?", caminho)
            if m and metodo == "GET" and m.group(2) is None:
                return self.ver_pedido(int(m.group(1)))
            if m and metodo == "POST" and m.group(2):
                return self.mudar_pedido(int(m.group(1)))
            m = re.fullmatch(r"/fluxos/([a-z][a-z0-9-]{0,47})", caminho)
            if m and metodo == "GET":
                return self.ver_fluxo(m.group(1), q)
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

    def do_PUT(self) -> None:
        self._rotear("PUT")

    def do_PATCH(self) -> None:
        self._rotear("PATCH")

    def _estatico(self, caminho: str) -> bool:
        """Serve o build do Vite (frontend/web/dist); sem build, o frontend/dashboard.html legado."""
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

    def salas(self, q: dict) -> None:
        with conectar() as con:
            quem = self._quem(con)
            linhas = con.execute(
                """SELECT sala, COUNT(*), MAX(criado), MAX(id), GROUP_CONCAT(DISTINCT CASE WHEN de != 'relay' THEN de END)
                   FROM msg GROUP BY sala ORDER BY MAX(id) DESC"""
            ).fetchall()
            canais = {c: (i, t, e, p) for i, t, e, p, c in con.execute(
                "SELECT id, titulo, estado, sala, canal FROM reuniao WHERE canal IS NOT NULL")}
            eu = quem.nome if (quem.nome and not quem.admin) else (q.get("eu") or quem.nome)
            contagem = self._nao_lidas(con, quem, eu) if eu else {}
        saida = []
        for s_, n, u, ult, a in linhas:
            item = {"sala": s_, "total": n, "ultima": u, "ultimo_id": ult, "agentes": [x for x in (a or "").split(",") if x]}
            if eu:
                item["nao_lidas"], item["mencoes"] = contagem.get(s_, (0, 0))
            if s_ in canais:
                i, t, e, p = canais[s_]
                item.update({"pai": p, "reuniao": {"id": i, "titulo": t, "estado": e}})
            saida.append(item)
        self._json(200, saida)

    def _nao_lidas(self, con: sqlite3.Connection, quem: Quem, eu: str) -> dict[str, tuple[int, int]]:
        """Por sala, do ponto de vista de `eu`: mensagens depois da última leitura que não são minhas, e quantas
        delas me mencionam (@nome, @apelido) ou são privadas para mim."""
        filtro, args = filtro_visiveis(quem, eu, False, "m.")
        apelido = con.execute("SELECT apelido FROM apelido WHERE nome=?", (eu,)).fetchone()
        nomes = [eu] + ([apelido[0]] if apelido else [])
        # O LIKE só pré-filtra; a fronteira do nome (`@ana` não é `@ana2`) é conferida aqui no Python.
        exato = re.compile(r"@(?:" + "|".join(map(re.escape, nomes)) + r")(?![\w.-])", re.IGNORECASE)
        marcas = [f"%@{n}%" for n in nomes]
        talvez = " OR ".join(["m.texto LIKE ?"] * len(marcas))
        contagem: dict[str, list[int]] = {}
        for sala, privada, texto in con.execute(
                f"SELECT m.sala, m.para=?, CASE WHEN {talvez} THEN m.texto END FROM msg m "
                "LEFT JOIN leitura l ON l.nome=? AND l.sala=m.sala "
                f"WHERE m.id>COALESCE(l.ultimo_id, 0) AND m.de IS NOT ? AND {filtro}",
                [eu, *marcas, eu, eu, *args]):
            c = contagem.setdefault(sala, [0, 0])
            c[0] += 1
            c[1] += bool(privada or (texto and exato.search(texto)))
        return {s: (n, m) for s, (n, m) in contagem.items()}

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
            apelidos = dict(con.execute("SELECT nome, apelido FROM apelido"))
            fotos = dict(con.execute("SELECT nome, versao FROM foto"))
        agora = time.time()
        self._json(200, [
            {"nome": n, "apelido": apelidos.get(n), "visto_em": iso(v) if v else None, "online": bool(v and agora - v < ONLINE_S),
             "tipo": t or ("ia" if re.match(r"^(claude|gemma|qwen|llama|gpt)", n) else "humano"),
             "tem_token": bool(tk), "foto": fotos.get(n)}
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
            indexar_msg(con, cur.lastrowid, texto)
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
            linha = con.execute("SELECT sala, de, texto FROM msg WHERE id=?", (msg_id,)).fetchone()
            if not linha:
                raise ErroHttp(404, "mensagem_inexistente", "Mensagem não existe.")
            sala, autor, texto_antigo = linha
            if not (quem.admin or quem.nome == autor):
                raise ErroHttp(403, "proibido", "Só o autor ou o admin apagam.")
            # Apagamento real; o evento guarda só o id (auditoria sem conteúdo).
            indexar_msg(con, msg_id, "", texto_antigo)
            con.execute("DELETE FROM msg WHERE id=?", (msg_id,))
            apagar_arquivos(con, "msg_id=?", [msg_id])
            con.execute("INSERT INTO evento (tipo, sala, msg_id, quando) VALUES ('apagada',?,?,?)",
                        (sala, msg_id, time.time()))
        notificar()
        self._vazio()

    def editar_mensagem(self, msg_id: int) -> None:
        self._corpo_cache = self._corpo()
        texto = self._corpo_cache.get("texto")
        if not isinstance(texto, str) or not texto.strip():
            raise ErroHttp(400, "texto_vazio", "Mande o texto novo.")
        if CREDENCIAL_RE.search(texto):
            raise ErroHttp(422, "credencial_detectada",
                           "A mensagem parece conter uma credencial (token, chave, senha). Não foi editada.")
        with conectar() as con:
            quem = self._quem(con)
            linha = con.execute("SELECT sala, de, texto FROM msg WHERE id=?", (msg_id,)).fetchone()
            if not linha:
                raise ErroHttp(404, "mensagem_inexistente", "Mensagem não existe.")
            sala, autor, texto_antigo = linha
            # Como no envio: só o token de admin (sem cookie) diz em nome de quem fala.
            eu = str(self._corpo_cache.get("de") or quem.nome or "") if (quem.admin and not quem.via_cookie) else quem.nome
            if eu != autor:
                raise ErroHttp(403, "proibido", "Só o autor edita.")
            con.execute("UPDATE msg SET texto=?, editado=? WHERE id=?", (texto, time.time(), msg_id))
            indexar_msg(con, msg_id, texto, texto_antigo)
            registrar_evento(con, "editada", sala, msg_id)
            m = linha_para_msg(con.execute(f"SELECT {COLUNAS} FROM msg WHERE id=?", (msg_id,)).fetchone())
        notificar()
        self._json(200, m)

    def _ler(self, con: sqlite3.Connection, quem: Quem, sala: str, eu: str | None, todas: bool,
             depois: int, sem_minhas: bool) -> list[dict]:
        filtro, args = filtro_visiveis(quem, eu, todas)
        extra = " AND de IS NOT ?" if sem_minhas else ""
        if sala == "*":  # todas as salas (serviço em segundo plano do app): cada mensagem leva a sala
            linhas = con.execute(
                f"SELECT {COLUNAS}, sala FROM msg WHERE id>? AND {filtro}{extra} ORDER BY id LIMIT 200",
                [depois, *args, *([eu] if sem_minhas else [])],
            ).fetchall()
            return com_anexos(con, [{**linha_para_msg(r[:-1]), "sala": r[-1]} for r in linhas])
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

    # busca e navegação (docs/PLANO-WEB-UX.md, fase 2)

    def buscar_mensagens(self, q: dict) -> None:
        """FTS nas mensagens que a pessoa vê, da mais recente. `sala` opcional; `antes` pagina pelo id."""
        sala = validar_sala(q["sala"]) if q.get("sala") else None
        termo = consulta_fts(q.get("q") or "")
        if not termo:
            raise ErroHttp(400, "busca_vazia", "Mande `q` com pelo menos uma palavra.")
        limite = min(max(int(q.get("limite", 30) or 30), 1), LIMITE_PAGINA)
        antes = int(q["antes"]) if q.get("antes") else None
        with conectar() as con:
            quem = self._quem(con)
            eu = quem.nome if (quem.nome and not quem.admin) else (q.get("eu") or quem.nome)
            filtro, args = filtro_visiveis(quem, eu, q.get("todas") == "1", "m.")
            conds, extra = [filtro], list(args)
            if sala:
                conds.append("m.sala=?")
                extra.append(sala)
            if antes:
                conds.append("m.id<?")
                extra.append(antes)
            cols = ", ".join(f"m.{c}" for c in COLUNAS.split(", "))
            linhas = con.execute(
                f"SELECT {cols}, m.sala FROM msg_busca JOIN msg m ON m.id=msg_busca.rowid WHERE msg_busca MATCH ? "
                f"AND {' AND '.join(conds)} "
                "ORDER BY m.id DESC LIMIT ?", [termo, *extra, limite + 1]).fetchall()
            msgs = com_anexos(con, [{**linha_para_msg(r[:-1]), "sala": r[-1]} for r in linhas[:limite]])
        self._json(200, {"mensagens": msgs, "tem_mais": len(linhas) > limite})

    def contexto_mensagem(self, mid: int, q: dict) -> None:
        """Para "ir para a respondida": a mensagem e até `n` antes e `n` depois, na mesma sala."""
        n = min(max(int(q.get("n", 20) or 20), 1), 50)
        with conectar() as con:
            quem = self._quem(con)
            eu = quem.nome if (quem.nome and not quem.admin) else (q.get("eu") or quem.nome)
            filtro, args = filtro_visiveis(quem, eu, q.get("todas") == "1")
            alvo = con.execute(f"SELECT sala FROM msg WHERE id=? AND {filtro}", [mid, *args]).fetchone()
            if not alvo:
                raise ErroHttp(404, "mensagem_inexistente", "Mensagem não existe (ou não é visível para você).")
            antes = con.execute(f"SELECT {COLUNAS} FROM msg WHERE sala=? AND id<? AND {filtro} ORDER BY id DESC LIMIT ?",
                                [alvo[0], mid, *args, n]).fetchall()
            depois = con.execute(f"SELECT {COLUNAS} FROM msg WHERE sala=? AND id>=? AND {filtro} ORDER BY id LIMIT ?",
                                 [alvo[0], mid, *args, n + 1]).fetchall()
            msgs = com_anexos(con, [linha_para_msg(r) for r in [*reversed(antes), *depois]])
        self._json(200, {"sala": alvo[0], "alvo": mid, "mensagens": msgs,
                         "tem_antes": len(antes) == n, "tem_depois": len(depois) == n + 1})

    def busca(self, q: dict) -> None:
        """Ctrl+K: até `limite` resultados de cada tipo. `sala` opcional restringe tarefas, artefatos, fatos e mensagens."""
        texto = " ".join(str(q.get("q") or "").split())[:100]
        if not texto:
            raise ErroHttp(400, "busca_vazia", "Mande `q`.")
        limite = min(max(int(q.get("limite", 5) or 5), 1), 20)
        sala = validar_sala(q["sala"]) if q.get("sala") else None
        like = "%" + texto.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        termo = consulta_fts(texto)
        so_sala, args_sala = (" AND sala=?", [sala]) if sala else ("", [])
        with conectar() as con:
            quem = self._quem(con)
            eu = quem.nome if (quem.nome and not quem.admin) else (q.get("eu") or quem.nome)
            filtro_m, args = filtro_visiveis(quem, eu, False, "m.")
            salas = [s for (s,) in con.execute(
                "SELECT sala FROM msg WHERE sala LIKE ? ESCAPE '\\' GROUP BY sala ORDER BY MAX(id) DESC LIMIT ?",
                (like, limite))]
            pessoas = [{"nome": n, "apelido": a} for n, a in con.execute(
                "SELECT n.nome, ap.apelido FROM (SELECT nome FROM agente UNION SELECT nome FROM presenca) n "
                "LEFT JOIN apelido ap ON ap.nome=n.nome WHERE n.nome LIKE ? ESCAPE '\\' OR ap.apelido LIKE ? ESCAPE '\\' "
                "ORDER BY n.nome LIMIT ?", (like, like, limite))]
            tarefas = [{"id": i, "sala": s, "titulo": t, "status": st} for i, s, t, st in con.execute(
                f"SELECT id, sala, titulo, status FROM tarefa WHERE titulo LIKE ? ESCAPE '\\'{so_sala} "
                "ORDER BY atualizado DESC LIMIT ?", [like, *args_sala, limite])]
            artefatos = [{"id": i, "sala": s, "titulo": t, "tipo": tp} for i, s, t, tp in con.execute(
                f"SELECT id, sala, titulo, tipo FROM artefato WHERE titulo LIKE ? ESCAPE '\\'{so_sala} "
                "ORDER BY atualizado DESC LIMIT ?", [like, *args_sala, limite])]
            fatos, mensagens = [], []
            if termo:
                fatos = [{"id": i, "sala": s, "sujeito": su, "predicado": p, "objeto": o} for i, s, su, p, o in con.execute(
                    "SELECT f.id, f.sala, f.sujeito, f.predicado, f.objeto FROM fato_busca JOIN fato f "
                    f"ON f.id=fato_busca.rowid WHERE fato_busca MATCH ? AND f.estado='vigente'"
                    f"{so_sala.replace('sala', 'f.sala')} ORDER BY bm25(fato_busca) LIMIT ?",
                    [termo, *args_sala, limite])]
                mensagens = [{"id": i, "sala": s, "de": d, "texto": t[:200], "criado_em": iso(c)}
                             for i, s, d, t, c in con.execute(
                    "SELECT m.id, m.sala, m.de, m.texto, m.criado FROM msg_busca JOIN msg m ON m.id=msg_busca.rowid "
                    f"WHERE msg_busca MATCH ? AND {filtro_m}{so_sala.replace('sala', 'm.sala')} ORDER BY m.id DESC LIMIT ?",
                    [termo, *args, *args_sala, limite])]
        self._json(200, {"salas": salas, "pessoas": pessoas, "tarefas": tarefas, "artefatos": artefatos,
                         "fatos": fatos, "mensagens": mensagens})

    def stream(self, q: dict) -> None:
        """SSE: `id` do evento = id da mensagem; reconecta com Last-Event-ID.
        `sala=*`: todas as salas que a pessoa vê (só mensagens; começa do agora e não marca presença)."""
        geral = q.get("sala") == "*"
        sala = "*" if geral else validar_sala(q.get("sala"))
        with conectar() as con:
            quem = self._quem(con)
            ultimo_evento = con.execute("SELECT COALESCE(MAX(seq),0) FROM evento").fetchone()[0]
            maior = con.execute("SELECT COALESCE(MAX(id),0) FROM msg").fetchone()[0]
        eu = quem.nome if (quem.nome and not quem.admin) else (q.get("eu") or quem.nome)
        todas = q.get("todas") == "1"
        depois = int(self.headers.get("Last-Event-ID") or q.get("depois") or 0) or (maior if geral else 0)
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
                    eventos = [] if geral else con.execute(
                        "SELECT seq, tipo, msg_id FROM evento WHERE seq>? AND sala=? ORDER BY seq", (ultimo_evento, sala)
                    ).fetchall()
                    if eu and not geral:  # o serviço em segundo plano não conta como "online"
                        marcar_visto(con, eu)
                for m in msgs:
                    depois = m["id"]
                    dados = json.dumps(m, ensure_ascii=False)
                    self.wfile.write(f"id: {m['id']}\nevent: mensagem\ndata: {dados}\n\n".encode())
                for seq, tipo, ref in eventos:
                    ultimo_evento = seq
                    if tipo == "editada":  # manda a mensagem inteira, se quem ouve pode vê-la
                        with conectar() as con:
                            filtro, args = filtro_visiveis(quem, eu, todas)
                            r = con.execute(f"SELECT {COLUNAS} FROM msg WHERE id=? AND {filtro}", [ref, *args]).fetchone()
                            if r:
                                dados = json.dumps(com_anexos(con, [linha_para_msg(r)])[0], ensure_ascii=False)
                                self.wfile.write(f"event: editada\ndata: {dados}\n\n".encode())
                        continue
                    self.wfile.write(f"event: {tipo}\ndata: {json.dumps({'id': ref})}\n\n".encode())
                digitando = [] if geral else [n for n in digitando_em(sala) if n != eu]
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


    def definir_apelido(self, nome: str) -> None:
        """Cada um muda o próprio apelido; o admin muda qualquer um. Vazio remove."""
        c = self._corpo()
        if not NOME_RE.match(nome):
            raise ErroHttp(400, "nome_invalido", "Nome inválido.")
        apelido = " ".join(str(c.get("apelido") or "").split())
        if apelido and not APELIDO_RE.match(apelido):
            raise ErroHttp(400, "apelido_invalido", "Apelido: até 24 caracteres (letras, números, espaço, . ' -).")
        with conectar() as con:
            quem = self._quem(con)
            autor = self._nome(quem, c)
            if not quem.admin and autor != nome:
                raise ErroHttp(403, "proibido", "Só dá para mudar o próprio apelido.")
            if apelido:
                outro = con.execute("SELECT 1 FROM agente WHERE nome=? COLLATE NOCASE AND nome!=? UNION "
                                    "SELECT 1 FROM presenca WHERE nome=? COLLATE NOCASE AND nome!=?",
                                    (apelido, nome, apelido, nome)).fetchone()
                if outro:
                    raise ErroHttp(409, "apelido_em_uso", "Esse apelido é o nome de outro participante.")
                try:
                    con.execute("INSERT INTO apelido VALUES (?,?,?,?) ON CONFLICT(nome) DO UPDATE SET apelido=excluded.apelido, "
                                "definido_por=excluded.definido_por, quando=excluded.quando", (nome, apelido, autor, time.time()))
                except sqlite3.IntegrityError:
                    raise ErroHttp(409, "apelido_em_uso", "Esse apelido já é de outra pessoa.") from None
                mensagem_sistema(con, "geral", f"✨ **{nome}** agora aparece como **{apelido}**")
            else:
                con.execute("DELETE FROM apelido WHERE nome=?", (nome,))
            registrar_evento(con, "apelido", "geral", 0)
        notificar()
        self._json(200, {"nome": nome, "apelido": apelido or None})

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
        """Quadro da sala. Filtros: sprint, status, responsavel, prioridade, etiqueta (nome), q (título/descrição).
        Ordem da fila: `ordem` manual primeiro, depois prioridade, depois a mais recente."""
        sala = validar_sala(q.get("sala"))
        filtro, args = ["t.sala=?"], [sala]
        if q.get("sprint"):
            filtro.append("t.sprint_id=?")
            args.append(int(q["sprint"]))
        for campo, validos in (("status", STATUS_TAREFA), ("prioridade", PRIORIDADES)):
            if q.get(campo):
                if q[campo] not in validos:
                    raise ErroHttp(400, f"{campo}_invalido", f"{campo} deve ser um de {', '.join(validos)}.")
                filtro.append(f"t.{campo}=?")
                args.append(q[campo])
        if q.get("responsavel"):
            filtro.append("t.responsavel=?")
            args.append(q["responsavel"])
        if q.get("etiqueta"):
            filtro.append("t.id IN (SELECT te.tarefa_id FROM tarefa_etiqueta te JOIN etiqueta e ON e.id=te.etiqueta_id "
                          "WHERE e.sala=? AND e.nome=?)")
            args += [sala, q["etiqueta"]]
        if q.get("q"):
            termo = "%" + q["q"].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            filtro.append("(t.titulo LIKE ? ESCAPE '\\' OR t.descricao LIKE ? ESCAPE '\\')")
            args += [termo, termo]
        rank = "CASE t.prioridade " + " ".join(f"WHEN '{p}' THEN {i}" for i, p in enumerate(PRIORIDADES)) + " END"
        cols = ", ".join(f"t.{c}" for c in COLS_TAREFA.split(", "))
        with conectar() as con:
            self._quem(con)
            linhas = con.execute(
                f"SELECT {cols} FROM tarefa t WHERE {' AND '.join(filtro)} "
                f"ORDER BY t.ordem IS NULL, t.ordem, {rank}, t.atualizado DESC", args).fetchall()
            self._json(200, com_extras(con, [tarefa_para_json(r) for r in linhas]))

    def _tarefa(self, con: sqlite3.Connection, tid: int) -> dict:
        linha = con.execute(f"SELECT {COLS_TAREFA} FROM tarefa WHERE id=?", (tid,)).fetchone()
        if not linha:
            raise ErroHttp(404, "tarefa_inexistente", "Tarefa não existe.")
        return tarefa_para_json(linha)

    def _tarefa_completa(self, con: sqlite3.Connection, tid: int) -> dict:
        t = com_extras(con, [self._tarefa(con, tid)])[0]
        t["itens"] = [{"id": i, "texto": texto, "feito": bool(feito), "ordem": ordem} for i, texto, feito, ordem in
                      con.execute("SELECT id, texto, feito, ordem FROM checklist WHERE tarefa_id=? ORDER BY ordem, id", (tid,))]
        t["atividade"] = [{"de": de, "campo": campo, "antes": antes, "depois": depois, "quando": iso(quando)}
                          for de, campo, antes, depois, quando in con.execute(
                              "SELECT de, campo, antes, depois, quando FROM atividade WHERE tarefa_id=? ORDER BY id DESC LIMIT 50", (tid,))]
        return t

    def ver_tarefa(self, tid: int) -> None:
        """Tarefa completa: etiquetas, itens do checklist e as últimas 50 mudanças (auditoria)."""
        with conectar() as con:
            self._quem(con)
            self._json(200, self._tarefa_completa(con, tid))

    def _definir_etiquetas(self, con: sqlite3.Connection, sala: str, tid: int, nomes: object) -> list[str] | None:
        """Troca as etiquetas da tarefa pelos nomes dados, criando as que faltam na sala. Devolve os nomes, ou None se igual."""
        if not isinstance(nomes, list) or len(nomes) > MAX_ETIQUETAS:
            raise ErroHttp(400, "etiquetas_invalidas", f"etiquetas: lista de até {MAX_ETIQUETAS} nomes.")
        limpos: list[str] = []
        for n in nomes:
            nome = " ".join(str(n or "").split())
            if not 1 <= len(nome) <= 24:
                raise ErroHttp(400, "etiqueta_invalida", "Etiqueta: 1–24 caracteres.")
            if nome.lower() not in (x.lower() for x in limpos):
                limpos.append(nome)
        antes = [n for (n,) in con.execute(
            "SELECT e.nome FROM tarefa_etiqueta te JOIN etiqueta e ON e.id=te.etiqueta_id WHERE te.tarefa_id=? ORDER BY e.nome", (tid,))]
        if sorted(x.lower() for x in antes) == sorted(x.lower() for x in limpos):
            return None
        con.execute("DELETE FROM tarefa_etiqueta WHERE tarefa_id=?", (tid,))
        for nome in limpos:
            con.execute("INSERT INTO etiqueta (sala, nome, cor) VALUES (?,?,?) ON CONFLICT(sala, nome) DO NOTHING",
                        (sala, nome, cor_padrao(nome)))
            eid = con.execute("SELECT id FROM etiqueta WHERE sala=? AND nome=?", (sala, nome)).fetchone()[0]
            con.execute("INSERT OR IGNORE INTO tarefa_etiqueta VALUES (?,?)", (tid, eid))
        return limpos

    def criar_tarefa(self, _q: dict) -> None:
        c = self._corpo()
        sala = validar_sala(c.get("sala"))
        v = validar_campos_tarefa({"status": "a_fazer", "prioridade": "nenhuma", **c, "titulo": c.get("titulo")})
        with conectar() as con:
            por = self._nome(self._quem(con), c)
            agora = time.time()
            cur = con.execute(
                f"INSERT INTO tarefa ({COLS_TAREFA.replace('id, ', '', 1)}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (sala, v["titulo"], v.get("descricao"), v["status"], v.get("responsavel"), v.get("sprint_id"), c.get("msg_id"),
                 por, agora, agora, v.get("prazo"), v["prioridade"], v.get("estimativa"), v.get("ordem")),
            )
            tid = cur.lastrowid
            if c.get("etiquetas"):
                self._definir_etiquetas(con, sala, tid, c["etiquetas"])
            registrar_atividade(con, tid, por, "criada", None, v["titulo"])
            resp = v.get("responsavel")
            mensagem_sistema(con, sala, f"📋 **{por}** criou a tarefa **#{tid}** {v['titulo']}" + (f" → @{resp}" if resp else ""))
            registrar_evento(con, "tarefa", sala, tid)
            t = self._tarefa_completa(con, tid)
        notificar()
        self._json(201, t)

    def alterar_tarefa(self, tid: int) -> None:
        c = self._corpo()
        v = validar_campos_tarefa(c)
        with conectar() as con:
            quem = self._quem(con)
            t = self._tarefa(con, tid)
            quem_nome = self._nome(quem, c)
            # Só grava (e registra na atividade) o que mudou de fato.
            comparavel = {**t, "prazo": datetime.fromisoformat(t["prazo"].replace("Z", "+00:00")).timestamp() if t["prazo"] else None}
            mudancas = {k: val for k, val in v.items() if comparavel.get(k) != val}
            mudou_etiquetas = self._definir_etiquetas(con, t["sala"], tid, c["etiquetas"]) if "etiquetas" in c else None
            if not mudancas and mudou_etiquetas is None:
                return self._json(200, self._tarefa_completa(con, tid))
            if mudancas:
                sets = ", ".join(f"{k}=?" for k in mudancas)
                con.execute(f"UPDATE tarefa SET {sets}, atualizado=? WHERE id=?", [*mudancas.values(), time.time(), tid])
            else:
                con.execute("UPDATE tarefa SET atualizado=? WHERE id=?", (time.time(), tid))
            for campo, novo in mudancas.items():
                antes = t.get(campo)
                if campo == "prazo":
                    novo = iso(novo) if novo else None
                if campo == "descricao":  # texto longo: a atividade guarda só que mudou
                    antes, novo = None, None
                registrar_atividade(con, tid, quem_nome, campo, antes, novo)
            if mudou_etiquetas is not None:
                registrar_atividade(con, tid, quem_nome, "etiquetas", None, mudou_etiquetas)
            novo_status = mudancas.get("status")
            if novo_status:
                rotulo = {"a_fazer": "voltou para a fazer", "fazendo": "pegou", "revisao": "mandou para revisão", "feito": "concluiu"}[novo_status]
                mensagem_sistema(con, t["sala"], f"{'✅' if novo_status == 'feito' else '🔁'} **{quem_nome}** {rotulo} **#{tid}** {t['titulo']}")
            registrar_evento(con, "tarefa", t["sala"], tid)
            completa = self._tarefa_completa(con, tid)
        notificar()
        self._json(200, completa)

    def apagar_tarefa(self, tid: int) -> None:
        with conectar() as con:
            quem = self._quem(con)
            linha = con.execute("SELECT sala, criada_por FROM tarefa WHERE id=?", (tid,)).fetchone()
            if not linha:
                raise ErroHttp(404, "tarefa_inexistente", "Tarefa não existe.")
            if not (quem.admin or quem.nome == linha[1]):
                raise ErroHttp(403, "proibido", "Só quem criou ou o admin apagam.")
            con.execute("DELETE FROM tarefa WHERE id=?", (tid,))
            con.execute("DELETE FROM tarefa_etiqueta WHERE tarefa_id=?", (tid,))
            con.execute("DELETE FROM checklist WHERE tarefa_id=?", (tid,))
            con.execute("DELETE FROM atividade WHERE tarefa_id=?", (tid,))
            registrar_evento(con, "tarefa", linha[0], tid)
        notificar()
        self._vazio()

    # checklist

    def _item_texto(self, c: dict) -> str:
        texto = " ".join(str(c.get("texto") or "").split())
        if not 1 <= len(texto) <= 300:
            raise ErroHttp(400, "item_invalido", "Item do checklist: 1–300 caracteres.")
        if CREDENCIAL_RE.search(texto):
            raise ErroHttp(422, "credencial_detectada", "O item parece conter uma credencial. Não foi salvo.")
        return texto

    def criar_item(self, tid: int) -> None:
        c = self._corpo()
        texto = self._item_texto(c)
        with conectar() as con:
            quem = self._nome(self._quem(con), c)
            t = self._tarefa(con, tid)
            total, ultima = con.execute("SELECT COUNT(*), MAX(ordem) FROM checklist WHERE tarefa_id=?", (tid,)).fetchone()
            if total >= MAX_CHECKLIST:
                raise ErroHttp(409, "checklist_cheio", f"Checklist com no máximo {MAX_CHECKLIST} itens.")
            con.execute("INSERT INTO checklist (tarefa_id, texto, ordem) VALUES (?,?,?)", (tid, texto, (ultima or 0) + 1))
            registrar_atividade(con, tid, quem, "checklist", None, f"+ {texto}")
            con.execute("UPDATE tarefa SET atualizado=? WHERE id=?", (time.time(), tid))
            registrar_evento(con, "tarefa", t["sala"], tid)
            completa = self._tarefa_completa(con, tid)
        notificar()
        self._json(201, completa)

    def alterar_item(self, tid: int, iid: int, metodo: str) -> None:
        # DELETE pode vir sem corpo (sessão/token de agente); com o token de admin, o corpo diz quem é (`de`).
        c = self._corpo() if metodo == "PATCH" or self.headers.get("Content-Length") else {}
        with conectar() as con:
            quem = self._nome(self._quem(con), c)
            t = self._tarefa(con, tid)
            item = con.execute("SELECT texto, feito FROM checklist WHERE id=? AND tarefa_id=?", (iid, tid)).fetchone()
            if not item:
                raise ErroHttp(404, "item_inexistente", "Item do checklist não existe nesta tarefa.")
            if metodo == "DELETE":
                con.execute("DELETE FROM checklist WHERE id=?", (iid,))
                registrar_atividade(con, tid, quem, "checklist", item[0], None)
            else:
                texto = self._item_texto(c) if "texto" in c else item[0]
                feito = bool(c["feito"]) if "feito" in c else bool(item[1])
                con.execute("UPDATE checklist SET texto=?, feito=? WHERE id=?", (texto, int(feito), iid))
                if feito != bool(item[1]):
                    registrar_atividade(con, tid, quem, "checklist", None, f"{'☑' if feito else '☐'} {texto}")
                if texto != item[0]:
                    registrar_atividade(con, tid, quem, "checklist", item[0], texto)
            con.execute("UPDATE tarefa SET atualizado=? WHERE id=?", (time.time(), tid))
            registrar_evento(con, "tarefa", t["sala"], tid)
            completa = self._tarefa_completa(con, tid)
        notificar()
        self._json(200, completa)

    # etiquetas

    def etiquetas(self, q: dict) -> None:
        """Etiquetas da sala com quantas tarefas usam cada uma."""
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            self._quem(con)
            linhas = con.execute(
                "SELECT e.id, e.nome, e.cor, COUNT(te.tarefa_id) FROM etiqueta e LEFT JOIN tarefa_etiqueta te ON te.etiqueta_id=e.id "
                "WHERE e.sala=? GROUP BY e.id ORDER BY e.nome", (sala,)).fetchall()
        self._json(200, [{"id": i, "nome": n, "cor": cor, "tarefas": total} for i, n, cor, total in linhas])

    def alterar_etiqueta(self, eid: int, metodo: str) -> None:
        """PATCH muda nome/cor; DELETE tira a etiqueta da sala e de todas as tarefas."""
        c = self._corpo() if metodo == "PATCH" else {}
        with conectar() as con:
            self._quem(con)
            linha = con.execute("SELECT sala, nome, cor FROM etiqueta WHERE id=?", (eid,)).fetchone()
            if not linha:
                raise ErroHttp(404, "etiqueta_inexistente", "Etiqueta não existe.")
            if metodo == "DELETE":
                con.execute("DELETE FROM tarefa_etiqueta WHERE etiqueta_id=?", (eid,))
                con.execute("DELETE FROM etiqueta WHERE id=?", (eid,))
            else:
                nome = " ".join(str(c.get("nome") or linha[1]).split())
                cor = c.get("cor", linha[2])
                if not 1 <= len(nome) <= 24 or not isinstance(cor, int) or isinstance(cor, bool) or not 0 <= cor < CORES_ETIQUETA:
                    raise ErroHttp(400, "etiqueta_invalida", f"Etiqueta: nome 1–24 caracteres, cor de 0 a {CORES_ETIQUETA - 1}.")
                try:
                    con.execute("UPDATE etiqueta SET nome=?, cor=? WHERE id=?", (nome, cor, eid))
                except sqlite3.IntegrityError:
                    raise ErroHttp(409, "etiqueta_em_uso", "Já existe uma etiqueta com esse nome na sala.") from None
            registrar_evento(con, "tarefa", linha[0], 0)
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
        propostos = c.get("fatos") or []
        if not isinstance(propostos, list) or len(propostos) > MAX_FATOS_ATA or not all(isinstance(p, dict) for p in propostos):
            raise ErroHttp(400, "fatos_invalidos", f"fatos deve ser uma lista de até {MAX_FATOS_ATA} {{sujeito, predicado, objeto, supera?}}.")
        propostos = [campos_fato(p) for p in propostos]
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
                    f"INSERT INTO tarefa ({COLS_TAREFA.replace('id, ', '', 1)}) VALUES (?,?,?,'a_fazer',?,?,?,?,?,?,NULL,'nenhuma',NULL,NULL)",
                    (r["sala"], titulo, f"Da reunião #{rid}", resp, sprint[0] if sprint else None, msg_id, eu, agora, agora),
                )
                criadas.append((cur.lastrowid, titulo, resp))
            if criadas:
                linhas = "\n".join(f"- **#{i}** {t}" + (f" → @{p}" if p else "") for i, t, p in criadas)
                mensagem_sistema(con, r["sala"], f"📋 Ações da reunião #{rid} viraram tarefas:\n{linhas}")
            con.execute("UPDATE reuniao SET estado='encerrada', ata=? WHERE id=?", (ata, rid))
            # Fatos da ata entram como candidatos: só viram memória quando um humano participante confirmar.
            candidatos = []
            for p in propostos:
                checar_supera(con, r["sala"], p["supera"])
                candidatos.append(inserir_fato(con, r["sala"], p, "ata", str(rid), "candidato", eu))
            if candidatos:
                n = len(candidatos)
                mensagem_sistema(con, r["sala"], f"🧠 {n} fato{'s' if n > 1 else ''} da reunião #{rid} "
                                                 f"aguarda{'m' if n > 1 else ''} confirmação de um participante.")
                registrar_evento(con, "fato", r["sala"], candidatos[0])
            evento_reuniao(con, r)
            registrar_evento(con, "tarefa", r["sala"], 0)
            r = self._reuniao(con, rid)
        notificar()
        r["tarefas_criadas"] = [i for i, _, _ in criadas]
        r["fatos_candidatos"] = candidatos
        self._json(200, r)

    # memória da equipe (docs/PLANO-MEMORIA.md, fase 1)

    def fatos(self, q: dict) -> None:
        """Busca nos fatos da sala: `q` (texto livre, FTS), `sujeito` (exato), `historico=1` inclui superados."""
        sala = validar_sala(q.get("sala"))
        limite = min(max(int(q.get("limite") or 10), 1), 50)
        filtro, args = ["f.sala=?"], [sala]
        if q.get("historico") != "1":
            filtro.append("f.estado='vigente'")
        cols = ", ".join(f"f.{c}" for c in COLS_FATO.split(", "))
        with conectar() as con:
            self._quem(con)
            if q.get("sujeito"):  # todos os nomes do mesmo nó (normalização + aliases vigentes)
                norm = normalizar(q["sujeito"])
                nomes = nomes_do_no(con, sala, mapa_aliases(con, sala).get(norm, norm))
                filtro.append(f"f.sujeito_norm IN ({','.join('?' * len(nomes))})")
                args += nomes
            termo = consulta_fts(q.get("q") or "")
            if (q.get("q") or "").strip() and not termo:
                return self._json(200, [])  # só símbolos: nada a buscar, em vez de cair na listagem sem filtro
            if termo:
                sql = (f"SELECT {cols} FROM fato_busca JOIN fato f ON f.id=fato_busca.rowid "
                       f"WHERE fato_busca MATCH ? AND {' AND '.join(filtro)} ORDER BY bm25(fato_busca), f.criado DESC LIMIT ?")
                args = [termo, *args]
            else:
                sql = f"SELECT {cols} FROM fato f WHERE {' AND '.join(filtro)} ORDER BY f.criado DESC LIMIT ?"
            linhas = con.execute(sql, [*args, limite]).fetchall()
        self._json(200, [fato_para_json(r) for r in linhas])

    def ver_fato(self, fid: int) -> None:
        """O fato e a cadeia de versões: as que ele superou (antes) e as que o superaram (depois)."""
        with conectar() as con:
            self._quem(con)
            linha = con.execute(f"SELECT {COLS_FATO} FROM fato WHERE id=?", (fid,)).fetchone()
            if not linha:
                raise ErroHttp(404, "fato_inexistente", "Fato não existe.")
            fato = fato_para_json(linha)
            antes, atual = [], fid
            while anterior := con.execute(f"SELECT {COLS_FATO} FROM fato WHERE superado_por=?", (atual,)).fetchone():
                antes.append(fato_para_json(anterior))
                atual = anterior[0]
            depois, atual = [], fato["superado_por"]
            while atual and (seguinte := con.execute(f"SELECT {COLS_FATO} FROM fato WHERE id=?", (atual,)).fetchone()):
                depois.append(fato_para_json(seguinte))
                atual = seguinte[8]
        fato["versoes_anteriores"], fato["versoes_seguintes"] = antes, depois
        self._json(200, fato)

    def _validar_origem(self, con: sqlite3.Connection, sala: str, tipo: str, oid: str) -> None:
        """A origem tem que existir, ser da mesma sala e ser pública (mensagem privada não vira fato da sala)."""
        if tipo == "arquivo":
            linha = con.execute("SELECT m.sala, m.para FROM arquivo a JOIN msg m ON m.id=a.msg_id WHERE a.id=?",
                                (oid,)).fetchone()
        elif not oid.isdigit():
            raise ErroHttp(400, "origem_invalida", "origem_id deve ser o id numérico da origem.")
        elif tipo == "msg":
            linha = con.execute("SELECT sala, para FROM msg WHERE id=?", (int(oid),)).fetchone()
        elif tipo == "ata":
            linha = con.execute("SELECT sala, NULL FROM reuniao WHERE id=? AND estado='encerrada'", (int(oid),)).fetchone()
        else:
            linha = con.execute("SELECT sala, NULL FROM tarefa WHERE id=?", (int(oid),)).fetchone()
        if not linha:
            raise ErroHttp(400, "origem_inexistente", f"Origem {tipo} {oid} não existe (ata: só de reunião encerrada).")
        if linha[0] != sala:
            raise ErroHttp(400, "origem_outra_sala", "A origem é de outra sala.")
        if linha[1] is not None:
            raise ErroHttp(400, "origem_privada", "Mensagem privada não pode ser origem de fato da sala.")

    def registrar_fato(self, _q: dict) -> None:
        c = self._corpo()
        sala = validar_sala(c.get("sala"))
        campos = campos_fato(c)
        otipo, oid = c.get("origem_tipo"), str(c.get("origem_id") or "").strip()
        if otipo not in ORIGENS_FATO or not oid:
            raise ErroHttp(400, "origem_obrigatoria", f"Todo fato precisa de origem: origem_tipo ({', '.join(ORIGENS_FATO)}) e origem_id.")
        with conectar() as con:
            autor = self._nome(self._quem(con), c)
            espera = FATOS.consumir(autor)
            if espera:
                raise ErroHttp(429, "limite_excedido", "Devagar: limite de fatos atingido.", espera)
            self._validar_origem(con, sala, otipo, oid)
            checar_supera(con, sala, campos["supera"])
            fid = inserir_fato(con, sala, campos, otipo, oid, "vigente", autor)
            superar(con, fid, campos["supera"])
            registrar_evento(con, "fato", sala, fid)
            linha = con.execute(f"SELECT {COLS_FATO} FROM fato WHERE id=?", (fid,)).fetchone()
        notificar()
        self._json(201, fato_para_json(linha))

    def candidatos(self, q: dict) -> None:
        """Fatos propostos em atas que ainda esperam um humano confirmar ou rejeitar."""
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            self._quem(con)
            linhas = con.execute(f"SELECT {COLS_FATO} FROM fato WHERE sala=? AND estado='candidato' ORDER BY id",
                                 (sala,)).fetchall()
        self._json(200, [fato_para_json(r) for r in linhas])

    def decidir_fato(self, fid: int, acao: str) -> None:
        """Confirmar ou rejeitar um candidato. Só humano com identidade forte e participante da reunião de origem."""
        with conectar() as con:
            quem = self._quem(con)
            eu = humano_confirmado(con, quem)
            if not eu:
                raise ErroHttp(403, "requer_humano",
                               "Só um humano com token próprio (tipo humano) confirma fatos; token de admin não conta.")
            linha = con.execute(f"SELECT {COLS_FATO} FROM fato WHERE id=?", (fid,)).fetchone()
            if not linha:
                raise ErroHttp(404, "fato_inexistente", "Fato não existe.")
            f = fato_para_json(linha)
            if f["estado"] != "candidato":
                raise ErroHttp(409, "fato_decidido", f"Esse fato já está {f['estado']}.")
            r = self._reuniao(con, int(f["origem"]["id"]))
            if eu not in r["participantes"] and eu != r["criada_por"]:
                raise ErroHttp(403, "proibido", "Só participantes da reunião de origem decidem os fatos dela.")
            estado = "vigente" if acao == "confirmar" else "rejeitado"
            if estado == "vigente":
                checar_supera(con, f["sala"], f["supera"])
            # Condicional no estado: dois humanos decidindo ao mesmo tempo, só o primeiro vale.
            if con.execute("UPDATE fato SET estado=?, confirmado_por=? WHERE id=? AND estado='candidato'",
                           (estado, eu, fid)).rowcount == 0:
                raise ErroHttp(409, "fato_decidido", "Esse fato acabou de ser decidido por outra pessoa.")
            if estado == "vigente":
                superar(con, fid, f["supera"])
            registrar_evento(con, "fato", f["sala"], fid)
            linha = con.execute(f"SELECT {COLS_FATO} FROM fato WHERE id=?", (fid,)).fetchone()
        notificar()
        self._json(200, fato_para_json(linha))


    # memória fase 6: aliases e grafo (docs/PLANO-MEMORIA.md, seção 11)

    def aliases(self, q: dict) -> None:
        """Aliases da sala (vigentes e candidatos), com quantos fatos cada nome junta."""
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            self._quem(con)
            linhas = con.execute(
                "SELECT a.nome, a.canonico, a.estado, a.criado_por, a.confirmado_por, a.origem_tipo, a.origem_id, a.criado, "
                "(SELECT COUNT(*) FROM fato f WHERE f.sala=a.sala AND f.estado='vigente' "
                " AND (f.sujeito_norm=a.nome_norm OR f.objeto_norm=a.nome_norm)) "
                "FROM alias a WHERE a.sala=? ORDER BY a.canonico_norm, a.nome_norm", (sala,)).fetchall()
        self._json(200, [{"nome": n, "canonico": c, "estado": e, "criado_por": por, "confirmado_por": conf,
                          "origem": {"tipo": ot, "id": oi} if ot else None, "criado_em": iso(cr), "fatos": total}
                         for n, c, e, por, conf, ot, oi, cr, total in linhas])

    def criar_alias(self, _q: dict) -> None:
        """Junta `nome` ao nó `canonico`. Humano grava direto; agente vira candidato quando o nó é grande
        (ALIAS_TRAVA_FATOS) ou quando o próprio `nome` já tem fatos (juntar errado contamina o grafo para trás)."""
        c = self._corpo()
        sala = validar_sala(c.get("sala"))
        nome = " ".join(str(c.get("nome") or "").split())
        canonico = " ".join(str(c.get("canonico") or "").split())
        if not (1 <= len(nome) <= 120 and 1 <= len(canonico) <= 120):
            raise ErroHttp(400, "alias_invalido", "nome e canonico: 1–120 caracteres.")
        nome_norm, canon_norm = normalizar(nome), normalizar(canonico)
        otipo, oid = c.get("origem_tipo"), (str(c["origem_id"]) if c.get("origem_id") is not None else None)
        if otipo is not None and otipo not in ORIGENS_FATO:
            raise ErroHttp(400, "origem_invalida", f"origem_tipo deve ser um de {', '.join(ORIGENS_FATO)}.")
        with conectar() as con:
            quem = self._quem(con)
            autor = self._nome(quem, c)
            if otipo and oid:
                self._validar_origem(con, sala, otipo, oid)
            aliases = mapa_aliases(con, sala)
            raiz = aliases.get(canon_norm, canon_norm)  # nunca grava cadeia: sempre a raiz
            if raiz != canon_norm:
                canonico = con.execute("SELECT canonico FROM alias WHERE sala=? AND nome_norm=?", (sala, canon_norm)).fetchone()[0]
            if nome_norm == raiz:
                raise ErroHttp(400, "alias_igual", "Esse nome já é o próprio nó (depois de normalizar).")
            if nome_norm in aliases.values():
                raise ErroHttp(409, "alias_e_canonico", f"\"{nome}\" já é o nó de outros aliases; junte ao contrário.")
            if con.execute("SELECT 1 FROM alias WHERE sala=? AND nome_norm=?", (sala, nome_norm)).fetchone():
                raise ErroHttp(409, "alias_existe", f"\"{nome}\" já tem alias nesta sala; apague antes de trocar.")
            if con.execute("SELECT COUNT(*) FROM alias WHERE sala=?", (sala,)).fetchone()[0] >= ALIAS_MAX_SALA:
                raise ErroHttp(409, "aliases_demais", f"Até {ALIAS_MAX_SALA} aliases por sala.")
            humano = humano_confirmado(con, quem)
            estado = "vigente"
            if not humano:
                fatos_no = con.execute(
                    f"SELECT COUNT(*) FROM fato WHERE sala=? AND estado='vigente' AND "
                    f"(sujeito_norm IN ({','.join('?' * len(nomes := nomes_do_no(con, sala, raiz)))}) "
                    f" OR objeto_norm IN ({','.join('?' * len(nomes))}))", [sala, *nomes, *nomes]).fetchone()[0]
                proprios = con.execute("SELECT COUNT(*) FROM fato WHERE sala=? AND estado='vigente' AND sujeito_norm=?",
                                       (sala, nome_norm)).fetchone()[0]
                if fatos_no >= ALIAS_TRAVA_FATOS or proprios:
                    estado = "candidato"
            con.execute("INSERT INTO alias VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (sala, nome, nome_norm, canonico, raiz, estado, autor, humano, otipo, oid, time.time()))
            if estado == "candidato":
                mensagem_sistema(con, sala, f"🔗 **{autor}** propôs juntar \"{titulo_seguro(nome)}\" a \"{titulo_seguro(canonico)}\" "
                                            "na memória; um humano da sala confirma.")
            registrar_evento(con, "fato", sala, 0)
        notificar()
        self._json(201, {"nome": nome, "canonico": canonico, "estado": estado, "criado_por": autor})

    def decidir_alias(self, _q: dict) -> None:
        """Humano confirma (`acao=confirmar`) ou recusa (`acao=rejeitar`) um alias candidato."""
        c = self._corpo()
        sala = validar_sala(c.get("sala"))
        nome_norm = normalizar(str(c.get("nome") or ""))
        if c.get("acao") not in ("confirmar", "rejeitar"):
            raise ErroHttp(400, "acao_invalida", "acao: confirmar ou rejeitar.")
        with conectar() as con:
            eu = humano_confirmado(con, self._quem(con))
            if not eu:
                raise ErroHttp(403, "requer_humano", "Só um humano com token próprio decide aliases candidatos.")
            if c["acao"] == "rejeitar":
                feito = con.execute("DELETE FROM alias WHERE sala=? AND nome_norm=? AND estado='candidato'", (sala, nome_norm)).rowcount
            else:
                feito = con.execute("UPDATE alias SET estado='vigente', confirmado_por=? WHERE sala=? AND nome_norm=? AND estado='candidato'",
                                    (eu, sala, nome_norm)).rowcount
            if not feito:
                raise ErroHttp(404, "alias_inexistente", "Não há alias candidato com esse nome nesta sala.")
            registrar_evento(con, "fato", sala, 0)
        notificar()
        self._vazio()

    def apagar_alias(self, q: dict) -> None:
        """Desfaz um alias (os fatos continuam todos lá; o nó só volta a se separar). Quem criou ou humano."""
        sala = validar_sala(q.get("sala"))
        nome_norm = normalizar(q.get("nome") or "")
        with conectar() as con:
            quem = self._quem(con)
            linha = con.execute("SELECT criado_por FROM alias WHERE sala=? AND nome_norm=?", (sala, nome_norm)).fetchone()
            if not linha:
                raise ErroHttp(404, "alias_inexistente", "Esse alias não existe nesta sala.")
            if not (humano_confirmado(con, quem) or quem.nome == linha[0] or quem.admin):
                raise ErroHttp(403, "proibido", "Só quem criou o alias ou um humano da sala desfaz.")
            con.execute("DELETE FROM alias WHERE sala=? AND nome_norm=?", (sala, nome_norm))
            registrar_evento(con, "fato", sala, 0)
        notificar()
        self._vazio()

    def sugestoes_alias(self, q: dict) -> None:
        """Nomes diferentes que provavelmente são a mesma coisa (artigo, plural, hífen, -mcp/-app).
        Só sugere: juntar é sempre uma ação explícita."""
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            self._quem(con)
            aliases = mapa_aliases(con, sala)
            ja = set(aliases) | {n for (n,) in con.execute("SELECT nome_norm FROM alias WHERE sala=?", (sala,))}
            contagem: dict[str, tuple[str, int]] = {}
            for texto, norm in con.execute("SELECT sujeito, sujeito_norm FROM fato WHERE sala=? AND estado='vigente'", (sala,)):
                raiz = aliases.get(norm, norm)
                rot, n = contagem.get(raiz, (texto, 0))
                contagem[raiz] = (rot, n + 1)
        grupos: dict[str, list[str]] = {}
        for norm in contagem:
            grupos.setdefault(chave_forte(norm), []).append(norm)
        saida = []
        for nomes in grupos.values():
            if len(nomes) < 2:
                continue
            alvo = max(nomes, key=lambda n: (contagem[n][1], -len(n)))  # o nome mais usado vira o canônico sugerido
            for n in nomes:
                if n != alvo and n not in ja:
                    saida.append({"nome": contagem[n][0], "canonico": contagem[alvo][0], "fatos": contagem[n][1]})
        self._json(200, sorted(saida, key=lambda s: -s["fatos"])[:50])

    def grafo(self, q: dict) -> None:
        """Vizinhança na memória: `sujeito=X` (resolve alias) ou `centro=agente:NOME` (fatos sobre o agente
        e os que ele registrou). `profundidade` 1 ou 2; até GRAFO_MAX_ARESTAS arestas (`cortado` se passar)."""
        sala = validar_sala(q.get("sala"))
        profundidade = 2 if q.get("profundidade") == "2" else 1
        centro, autor = q.get("centro") or "", None
        if centro.startswith("agente:"):
            autor = centro[len("agente:"):]
            if not NOME_RE.match(autor):
                raise ErroHttp(400, "nome_invalido", "Agente inválido.")
            nome = autor
        else:
            nome = q.get("sujeito") or centro
        if not nome.strip():
            raise ErroHttp(400, "sujeito_obrigatorio", "Informe `sujeito` ou `centro=agente:NOME`.")
        with conectar() as con:
            self._quem(con)
            aliases = mapa_aliases(con, sala)
            norm = normalizar(nome)
            centros = {aliases.get(norm, norm)}
            if autor:  # o agente também é conhecido pelo apelido de exibição
                apelido = con.execute("SELECT apelido FROM apelido WHERE nome=?", (autor,)).fetchone()
                if apelido:
                    centros.add(aliases.get(normalizar(apelido[0]), normalizar(apelido[0])))
            g = montar_grafo(con, sala, centros, autor, profundidade)
        self._json(200, {"centro": sorted(centros)[0], "centros": sorted(centros), **g})

    # perfil (docs/PLANO-PERFIL.md)

    CAMPOS_PERSONA = (("equipe", 60), ("papel", 160), ("foco", 160), ("tom", 80), ("limites", 240))

    def _pode_editar_perfil(self, con: sqlite3.Connection, quem: "Quem", nome: str) -> bool:
        """Dono (humano com identidade forte) ou admin. O próprio humano edita a própria ficha."""
        if quem.admin:
            return True
        eu = humano_confirmado(con, quem)
        if not eu:
            return False
        dono = con.execute("SELECT dono FROM agente WHERE nome=?", (nome,)).fetchone()
        return eu == nome or bool(dono and dono[0] == eu)

    def perfil(self, nome: str, q: dict) -> None:
        if not NOME_RE.match(nome):
            raise ErroHttp(400, "nome_invalido", "Nome inválido.")
        with conectar() as con:
            quem = self._quem(con)
            ag = con.execute("SELECT tipo, dono, criado, revogado, token_hash IS NOT NULL FROM agente WHERE nome=?", (nome,)).fetchone()
            visto = con.execute("SELECT visto FROM presenca WHERE nome=?", (nome,)).fetchone()
            escreveu = con.execute("SELECT MAX(criado) FROM msg WHERE de=?", (nome,)).fetchone()[0]
            if not ag and not visto and not escreveu:
                raise ErroHttp(404, "participante_inexistente", "Ninguém com esse nome por aqui.")
            apelido = con.execute("SELECT apelido FROM apelido WHERE nome=?", (nome,)).fetchone()
            pers = con.execute("SELECT equipe, papel, foco, tom, limites, editado_por, quando FROM persona WHERE nome=?",
                               (nome,)).fetchone()
            tarefas = con.execute("SELECT id, sala, titulo, status, prioridade FROM tarefa WHERE responsavel=? AND status!='feito' "
                                  "ORDER BY atualizado DESC LIMIT 20", (nome,)).fetchall()
            fatos = con.execute("SELECT COUNT(*) FROM fato WHERE autor=? AND estado='vigente'", (nome,)).fetchone()[0]
            salas = [r[0] for r in con.execute("SELECT sala FROM msg WHERE de=? GROUP BY sala ORDER BY MAX(id) DESC LIMIT 10", (nome,))]
            pode = self._pode_editar_perfil(con, quem, nome)
            foto = con.execute("SELECT versao FROM foto WHERE nome=?", (nome,)).fetchone()
            eu = humano_confirmado(con, quem)
            troca = bool(eu and (eu == nome or (ag and ag[1] == eu)))
            tipo = ag[0] if ag else ("ia" if re.match(r"^(claude|gemma|qwen|llama|gpt)", nome) else "humano")
        v = visto[0] if visto else None
        perfil = {
            "nome": nome, "apelido": apelido[0] if apelido else None, "tipo": tipo, "dono": ag[1] if ag else None,
            "online": bool(v and time.time() - v < ONLINE_S), "visto_em": iso(v) if v else None,
            "ultima_mensagem_em": iso(escreveu) if escreveu else None, "salas": salas,
            "persona": dict(zip(("equipe", "papel", "foco", "tom", "limites", "editado_por"), pers[:6]),
                            editado_em=iso(pers[6])) if pers else None,
            "tarefas": [{"id": i, "sala": sl, "titulo": t, "status": st, "prioridade": pr} for i, sl, t, st, pr in tarefas],
            "fatos_registrados": fatos, "pode_editar": pode, "foto": foto[0] if foto else None,
            "pode_trocar_foto": troca,
        }
        if pode and ag:  # acesso: só dono/admin
            perfil["acesso"] = {"token_ativo": bool(ag[4] and not ag[3]), "criado_em": iso(ag[2]),
                                "revogado_em": iso(ag[3]) if ag[3] else None}
        self._json(200, perfil)

    def editar_persona(self, nome: str) -> None:
        c = self._corpo()
        campos = {}
        for campo, maximo in self.CAMPOS_PERSONA:
            valor = " ".join(str(c.get(campo) or "").split())
            if len(valor) > maximo:
                raise ErroHttp(400, f"{campo}_invalido", f"{campo}: até {maximo} caracteres.")
            if CREDENCIAL_RE.search(valor):
                raise ErroHttp(422, "credencial_detectada", "A ficha parece conter uma credencial. Não foi salva.")
            campos[campo] = valor or None
        with conectar() as con:
            quem = self._quem(con)
            if not self._pode_editar_perfil(con, quem, nome):
                raise ErroHttp(403, "requer_dono", "Só o dono (com token humano próprio) ou o admin editam a ficha.")
            autor = humano_confirmado(con, quem) or quem.nome or "admin"
            con.execute("INSERT INTO persona VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(nome) DO UPDATE SET equipe=excluded.equipe, "
                        "papel=excluded.papel, foco=excluded.foco, tom=excluded.tom, limites=excluded.limites, "
                        "editado_por=excluded.editado_por, quando=excluded.quando",
                        (nome, *campos.values(), autor, time.time()))
            registrar_evento(con, "perfil", "geral", 0)
        notificar()
        self._vazio()

    FOTO_MAX = 300_000
    # Só bitmap: SVG aberto direto no navegador roda script. Confere a assinatura, não o que o cliente diz.
    FOTO_ASSINATURAS = ((b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8\xff", "image/jpeg"), (b"RIFF", "image/webp"))

    def ver_foto(self, nome: str) -> None:
        with conectar() as con:
            self._quem(con)
            linha = con.execute("SELECT tipo, dados FROM foto WHERE nome=?", (nome,)).fetchone()
        if not linha:
            raise ErroHttp(404, "sem_foto", "Sem foto de perfil.")
        self._enviar(200, linha[1], linha[0], {"Cache-Control": "private, max-age=31536000, immutable",
                                               "Content-Security-Policy": "sandbox; default-src 'none'"})

    def trocar_foto(self, nome: str) -> None:
        c = self._corpo(self.FOTO_MAX * 4 // 3 + 1024)
        try:
            dados = base64.b64decode(str(c.get("dados") or ""), validate=True)
        except ValueError:
            raise ErroHttp(400, "foto_invalida", "Mande a imagem em base64 no campo dados.") from None
        tipo = next((t for assin, t in self.FOTO_ASSINATURAS if dados.startswith(assin)
                     and (t != "image/webp" or dados[8:12] == b"WEBP")), None)
        if not tipo:
            raise ErroHttp(415, "foto_formato", "Foto: PNG, JPEG ou WebP.")
        if len(dados) > self.FOTO_MAX:
            raise ErroHttp(413, "foto_grande", f"Foto: até {self.FOTO_MAX // 1000} KB.")
        with conectar() as con:
            quem = self._quem(con)
            # Foto é identidade: nem o admin troca a dos outros (ele só remove). Vale a própria pessoa ou o dono do agente.
            autor = humano_confirmado(con, quem)
            dono = con.execute("SELECT dono FROM agente WHERE nome=?", (nome,)).fetchone()
            if not autor or (autor != nome and not (dono and dono[0] == autor)):
                raise ErroHttp(403, "requer_dono", "Só a própria pessoa (ou o dono do agente) troca a foto, com o token humano dela.")
            versao = (con.execute("SELECT versao FROM foto WHERE nome=?", (nome,)).fetchone() or (0,))[0] + 1
            con.execute("INSERT INTO foto VALUES (?,?,?,?,?,?) ON CONFLICT(nome) DO UPDATE SET tipo=excluded.tipo, "
                        "dados=excluded.dados, versao=excluded.versao, editado_por=excluded.editado_por, quando=excluded.quando",
                        (nome, tipo, dados, versao, autor, time.time()))
            registrar_evento(con, "perfil", "geral", 0)
        notificar()
        self._json(200, {"foto": versao})

    def apagar_foto(self, nome: str) -> None:
        with conectar() as con:
            quem = self._quem(con)
            if not self._pode_editar_perfil(con, quem, nome):
                raise ErroHttp(403, "requer_dono", "Só a própria pessoa, o dono do agente ou o admin removem a foto.")
            con.execute("DELETE FROM foto WHERE nome=?", (nome,))
            registrar_evento(con, "perfil", "geral", 0)
        notificar()
        self._vazio()

    def definir_dono(self, nome: str) -> None:
        c = self._corpo()
        dono = c.get("dono") or None
        if dono is not None and (not isinstance(dono, str) or not NOME_RE.match(dono)):
            raise ErroHttp(400, "dono_invalido", "Dono inválido.")
        with conectar() as con:
            if not self._quem(con).admin:
                raise ErroHttp(403, "proibido", "Só o admin define o dono de um agente.")
            if not con.execute("UPDATE agente SET dono=? WHERE nome=?", (dono, nome)).rowcount:
                raise ErroHttp(404, "agente_inexistente", "Esse agente não tem cadastro (token).")
            registrar_evento(con, "perfil", "geral", 0)
        notificar()
        self._vazio()

    # artefatos (docs/PLANO-ARTEFATOS.md)

    def _artefato(self, con: sqlite3.Connection, aid: int) -> dict:
        linha = con.execute(f"SELECT {COLS_ARTEFATO} FROM artefato WHERE id=?", (aid,)).fetchone()
        if not linha:
            raise ErroHttp(404, "artefato_inexistente", "Artefato não existe.")
        return artefato_para_json(linha)

    def artefatos(self, q: dict) -> None:
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            self._quem(con)
            cols = ", ".join(f"a.{c}" for c in COLS_ARTEFATO.split(", "))
            linhas = con.execute(
                f"SELECT {cols}, v.autor, v.resumo FROM artefato a LEFT JOIN artefato_versao v "
                "ON v.artefato_id=a.id AND v.versao=a.versao_atual WHERE a.sala=? ORDER BY a.atualizado DESC LIMIT 100",
                (sala,)).fetchall()
        a = []
        for r in linhas:  # + quem mexeu por último e o resumo da versão atual
            x = artefato_para_json(r[:-2])
            x["autor_versao"], x["resumo"] = r[-2], r[-1]
            a.append(x)
        self._json(200, a)

    def ver_artefato(self, aid: int, q: dict) -> None:
        with conectar() as con:
            self._quem(con)
            a = self._artefato(con, aid)
            try:
                versao = int(q.get("versao") or a["versao"])
            except ValueError:
                raise ErroHttp(400, "versao_invalida", "versao deve ser inteiro.") from None
            v = con.execute("SELECT conteudo, resumo, autor, criado FROM artefato_versao WHERE artefato_id=? AND versao=?",
                            (aid, versao)).fetchone()
            if not v:
                raise ErroHttp(404, "versao_inexistente", "Essa versão não existe.")
        a.update({"versao_vista": versao, "conteudo": v[0], "resumo": v[1], "autor_versao": v[2], "versao_em": iso(v[3])})
        self._json(200, a)

    def versoes_artefato(self, aid: int) -> None:
        with conectar() as con:
            self._quem(con)
            self._artefato(con, aid)
            linhas = con.execute("SELECT versao, resumo, autor, criado, length(conteudo) FROM artefato_versao "
                                 "WHERE artefato_id=? ORDER BY versao DESC", (aid,)).fetchall()
        self._json(200, [{"versao": v, "resumo": r, "autor": a, "criado_em": iso(c), "tamanho": t} for v, r, a, c, t in linhas])

    def criar_artefato(self, _q: dict) -> None:
        c = self._corpo(ARTEFATO_MAX * 2 + 16 * 1024)  # folga pro escape do JSON; o limite real é no conteúdo
        sala = validar_sala(c.get("sala"))
        titulo = " ".join(str(c.get("titulo") or "").split())
        tipo = c.get("tipo")
        if not 1 <= len(titulo) <= 120:
            raise ErroHttp(400, "titulo_invalido", "Título: 1–120 caracteres.")
        if tipo not in TIPOS_ARTEFATO:
            raise ErroHttp(400, "tipo_invalido", f"Tipo: {', '.join(TIPOS_ARTEFATO)}.")
        conteudo, resumo = conteudo_artefato(c)
        with conectar() as con:
            autor = self._nome(self._quem(con), c)
            espera = ENVIOS.consumir(autor)
            if espera:
                raise ErroHttp(429, "limite_excedido", "Devagar: limite de envio atingido.", espera)
            agora = time.time()
            cur = con.execute("INSERT INTO artefato (sala, titulo, tipo, criado_por, criado, atualizado) VALUES (?,?,?,?,?,?)",
                              (sala, titulo, tipo, autor, agora, agora))
            aid = cur.lastrowid
            con.execute("INSERT INTO artefato_versao VALUES (?,1,?,?,?,?)", (aid, conteudo, resumo, autor, agora))
            # Cartão na conversa: mensagem de sistema com o marcador que o web/app transformam em cartão.
            mid = mensagem_sistema(con, sala, f"{ICONE_ARTEFATO[tipo]} **{autor}** criou o artefato [[artefato:{aid}]] "
                                              f"**{titulo_seguro(titulo)}** ({tipo}, v1)")
            con.execute("UPDATE artefato SET msg_id=? WHERE id=?", (mid, aid))
            registrar_evento(con, "artefato", sala, aid)
            a = self._artefato(con, aid)
        notificar()
        self._json(201, a)

    def atualizar_artefato(self, aid: int) -> None:
        c = self._corpo(ARTEFATO_MAX * 2 + 16 * 1024)
        conteudo, resumo = conteudo_artefato(c)
        base = c.get("base")
        if not isinstance(base, int) or isinstance(base, bool):
            raise ErroHttp(400, "base_obrigatoria", "Mande `base`: a versão que você leu antes de editar.")
        with conectar() as con:
            autor = self._nome(self._quem(con), c)
            espera = ENVIOS.consumir(autor)
            if espera:
                raise ErroHttp(429, "limite_excedido", "Devagar: limite de envio atingido.", espera)
            a = self._artefato(con, aid)
            n, total = con.execute("SELECT COUNT(*), COALESCE(SUM(length(conteudo)),0) FROM artefato_versao WHERE artefato_id=?",
                                   (aid,)).fetchone()
            if n >= VERSOES_MAX or total + len(conteudo.encode()) > ARTEFATO_TOTAL_MAX:
                raise ErroHttp(409, "artefato_cheio", "Esse artefato chegou ao limite de versões; crie um novo a partir dele.")
            if a["estado"] == "arquivado":
                raise ErroHttp(409, "artefato_arquivado", "Artefato arquivado não recebe versões novas.")
            nova = a["versao"] + 1
            # Condicional na versão: quem leu uma versão velha não sobrescreve a edição de outra pessoa.
            agora = time.time()
            if con.execute("UPDATE artefato SET versao_atual=?, atualizado=?, estado='rascunho' WHERE id=? AND versao_atual=?",
                           (nova, agora, aid, base)).rowcount == 0:
                raise ErroHttp(409, "conflito", f"O artefato já está na v{a['versao']}; leia de novo e reaplique a sua mudança.")
            con.execute("INSERT INTO artefato_versao VALUES (?,?,?,?,?,?)", (aid, nova, conteudo, resumo, autor, agora))
            registrar_evento(con, "artefato", a["sala"], aid)
            a = self._artefato(con, aid)
        notificar()
        self._json(200, a)

    def decidir_artefato(self, aid: int, acao: str) -> None:
        """Aprovar (vira fato na memória) ou arquivar. Só humano com identidade forte."""
        with conectar() as con:
            quem = self._quem(con)
            eu = humano_confirmado(con, quem)
            if not eu:
                raise ErroHttp(403, "requer_humano",
                               "Só um humano com token próprio (tipo humano) aprova ou arquiva artefatos.")
            a = self._artefato(con, aid)
            estado = "aprovado" if acao == "aprovar" else "arquivado"
            if a["estado"] == estado:
                raise ErroHttp(409, "artefato_decidido", f"O artefato já está {estado}.")
            con.execute("UPDATE artefato SET estado=?, atualizado=? WHERE id=?", (estado, time.time(), aid))
            anterior = con.execute("SELECT f.id FROM artefato a JOIN fato f ON f.id=a.fato_id "
                                   "WHERE a.id=? AND f.estado='vigente'", (aid,)).fetchone()
            if estado == "aprovado" and a["msg_id"]:
                # Reaprovação depois de editar: o fato novo supera o da aprovação anterior (um vigente só).
                campos = {"sujeito": a["titulo"][:120], "predicado": "segue o artefato",
                          "objeto": f"#{aid} v{a['versao']} ({a['tipo']})", "supera": anterior[0] if anterior else None}
                fid = inserir_fato(con, a["sala"], campos, "msg", str(a["msg_id"]), "vigente", eu)
                superar(con, fid, campos["supera"])
                con.execute("UPDATE fato SET confirmado_por=? WHERE id=?", (eu, fid))
                con.execute("UPDATE artefato SET fato_id=? WHERE id=?", (fid, aid))
                registrar_evento(con, "fato", a["sala"], fid)
            elif estado == "arquivado" and anterior:  # arquivado não é mais referência
                con.execute("UPDATE fato SET estado='superado' WHERE id=? AND estado='vigente'", (anterior[0],))
                registrar_evento(con, "fato", a["sala"], anterior[0])
            mensagem_sistema(con, a["sala"], f"{'✅' if estado == 'aprovado' else '🗄️'} **{eu}** "
                                             f"{'aprovou' if estado == 'aprovado' else 'arquivou'} o artefato "
                                             f"[[artefato:{aid}]] **{titulo_seguro(a['titulo'])}** (v{a['versao']})")
            registrar_evento(con, "artefato", a["sala"], aid)
            a = self._artefato(con, aid)
        notificar()
        self._json(200, a)


    # workflows (docs/PLANO-FLUXOS.md): o relay é catálogo e correio. Nunca executa nem aprova nada.

    def fluxos(self, q: dict) -> None:
        """Última versão de cada fluxo da sala (ou todas as versões de `nome`)."""
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            self._quem(con)
            linhas = con.execute(
                "SELECT nome, versao, sha256, descricao, pior_caso, publicado_por, criado FROM fluxo f WHERE sala=? "
                "AND versao=(SELECT MAX(versao) FROM fluxo g WHERE g.sala=f.sala AND g.nome=f.nome) ORDER BY nome",
                (sala,)).fetchall()
        self._json(200, [{"nome": n, "versao": v, "sha256": h, "descricao": d, "pior_caso": p, "publicado_por": a,
                          "criado_em": iso(c)} for n, v, h, d, p, a, c in linhas])

    def ver_fluxo(self, nome: str, q: dict) -> None:
        sala = validar_sala(q.get("sala"))
        with conectar() as con:
            self._quem(con)
            if q.get("versao"):
                linha = con.execute("SELECT versao, sha256, conteudo, layout, publicado_por, criado FROM fluxo "
                                    "WHERE sala=? AND nome=? AND versao=?", (sala, nome, int(q["versao"]))).fetchone()
            else:
                linha = con.execute("SELECT versao, sha256, conteudo, layout, publicado_por, criado FROM fluxo "
                                    "WHERE sala=? AND nome=? ORDER BY versao DESC LIMIT 1", (sala, nome)).fetchone()
            versoes = [v for (v,) in con.execute("SELECT versao FROM fluxo WHERE sala=? AND nome=? ORDER BY versao DESC",
                                                 (sala, nome))]
        if not linha:
            raise ErroHttp(404, "fluxo_inexistente", "Esse fluxo (ou versão) não existe nesta sala.")
        v, h, conteudo, layout, autor, criado = linha
        # `conteudo` é a forma canônica: quem baixa recalcula o SHA-256 e compara com `sha256`.
        self._json(200, {"nome": nome, "versao": v, "sha256": h, "conteudo": conteudo,
                         "layout": json.loads(layout) if layout else None, "publicado_por": autor,
                         "criado_em": iso(criado), "versoes": versoes})

    def publicar_fluxo(self, _q: dict) -> None:
        """Publicar não aprova nem dá permissão de rodar (seção 4). nome@versao é imutável."""
        c = self._corpo(relay_fluxos.TAM_MAX * 2 + 16 * 1024)
        sala = validar_sala(c.get("sala"))
        try:
            fl = relay_fluxos.validar(c.get("fluxo"))
        except relay_fluxos.ErroFluxo as e:
            raise ErroHttp(422, e.codigo, e.detalhe) from None
        conteudo = relay_fluxos.canonico(fl.doc).decode()
        if CREDENCIAL_RE.search(conteudo):
            raise ErroHttp(422, "credencial_detectada", "O fluxo parece conter uma credencial. Segredo nunca vem do relay.")
        layout = c["fluxo"].get("layout")
        with conectar() as con:
            autor = self._nome(self._quem(con), c)
            espera = ENVIOS.consumir(autor)
            if espera:
                raise ErroHttp(429, "limite_excedido", "Devagar: limite de envio atingido.", espera)
            existente = con.execute("SELECT sha256 FROM fluxo WHERE sala=? AND nome=? AND versao=?",
                                    (sala, fl.nome, fl.versao)).fetchone()
            if existente and existente[0] != fl.sha256:
                raise ErroHttp(409, "versao_publicada", f"{fl.nome}@{fl.versao} já existe com outro conteúdo; "
                                                       "publique uma versão nova.")
            if not existente:
                con.execute("INSERT INTO fluxo VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (sala, fl.nome, fl.versao, fl.sha256, conteudo, json.dumps(layout) if layout else None,
                             fl.doc.get("description"), fl.pior_caso, autor, time.time()))
                mensagem_sistema(con, sala, f"🧩 **{autor}** publicou o fluxo `{fl.nome}@{fl.versao}` "
                                            f"(pior caso: {fl.pior_caso} passos, sha256 `{fl.sha256[:12]}…`)")
                registrar_evento(con, "fluxo", sala, 0)
        notificar()
        self._json(200 if existente else 201, {"nome": fl.nome, "versao": fl.versao, "sha256": fl.sha256,
                                               "pior_caso": fl.pior_caso})

    def _expirar_pedidos(self, con: sqlite3.Connection) -> None:
        agora = time.time()
        for pid, sala, de, agente, nome, versao in con.execute(
                "SELECT id, sala, de, agente, nome, versao FROM fluxo_pedido WHERE estado='pendente' AND expira<?",
                (agora,)).fetchall():
            con.execute("UPDATE fluxo_pedido SET estado='expirado', atualizado=? WHERE id=?", (agora, pid))
            mensagem_sistema(con, sala, f"⌛ O pedido [[pedido:{pid}]] de **{de}** para **{agente}** "
                                        f"(`{nome}@{versao}`) expirou sem resposta.")

    def _pedido(self, con: sqlite3.Connection, pid: int, quem: Quem) -> dict:
        linha = con.execute(f"SELECT {COLS_PEDIDO} FROM fluxo_pedido WHERE id=?", (pid,)).fetchone()
        if not linha:
            raise ErroHttp(404, "pedido_inexistente", "Pedido não existe.")
        p = pedido_para_json(linha)
        if not quem.admin and quem.nome not in (p["de"], p["agente"]):
            raise ErroHttp(404, "pedido_inexistente", "Pedido não existe.")
        return p

    def pedir_fluxo(self, _q: dict) -> None:
        """Cria o pedido (seção 5/12). O executor do `agente` decide se roda; aqui só se checa o básico."""
        c = self._corpo()
        sala = validar_sala(c.get("sala"))
        agente, nome, versao = str(c.get("agente") or ""), str(c.get("nome") or ""), c.get("versao")
        if not NOME_RE.match(agente):
            raise ErroHttp(400, "agente_invalido", "Diga a qual agente pedir (`agente`).")
        if not isinstance(versao, int) or isinstance(versao, bool):
            raise ErroHttp(400, "versao_invalida", "`versao` deve ser inteiro.")
        params, cadeia = c.get("params", {}), c.get("chain", [])
        expect = c.get("expect_sha256")
        if not isinstance(params, dict):
            raise ErroHttp(400, "params_invalidos", "`params` deve ser um objeto.")
        if expect is not None and not (isinstance(expect, str) and relay_fluxos.SHA_RE.match(expect)):
            raise ErroHttp(400, "hash_invalido", "`expect_sha256`: 64 caracteres hex.")
        try:
            relay_fluxos.validar_cadeia(cadeia, f"{agente}:{nome}@{versao}")
        except relay_fluxos.ErroFluxo as e:
            raise ErroHttp(422, e.codigo, e.detalhe) from None
        prazo = c.get("prazo_s", 1800)
        if not isinstance(prazo, int) or not 60 <= prazo <= 7200:
            raise ErroHttp(400, "prazo_invalido", "`prazo_s`: de 60 a 7200 segundos para o dono aceitar.")
        texto_params = json.dumps(params, ensure_ascii=False, sort_keys=True)
        if len(texto_params) > 4000 or CREDENCIAL_RE.search(texto_params):
            raise ErroHttp(422, "params_recusados", "Parâmetros grandes demais ou com cara de credencial.")
        correlacao = str(c.get("correlation_id") or secrets.token_hex(16))
        if not re.fullmatch(r"[\w-]{8,64}", correlacao):
            raise ErroHttp(400, "correlacao_invalida", "`correlation_id`: 8–64 caracteres (letras, números, _ -).")
        with conectar() as con:
            de = self._nome(self._quem(con), c)
            espera = ENVIOS.consumir(de)
            if espera:
                raise ErroHttp(429, "limite_excedido", "Devagar: limite de envio atingido.", espera)
            fluxo = con.execute("SELECT sha256 FROM fluxo WHERE sala=? AND nome=? AND versao=?",
                                (sala, nome, versao)).fetchone()
            if not fluxo:
                raise ErroHttp(404, "fluxo_inexistente", f"`{nome}@{versao}` não está no catálogo desta sala.")
            if expect and expect != fluxo[0]:
                raise ErroHttp(409, "hash_diferente", f"`{nome}@{versao}` no catálogo tem outro hash.")
            agora = time.time()
            try:
                cur = con.execute(
                    "INSERT INTO fluxo_pedido (sala, de, agente, nome, versao, expect_sha256, params, cadeia, correlation_id, "
                    "criado, atualizado, expira) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (sala, de, agente, nome, versao, expect, texto_params, json.dumps(cadeia), correlacao, agora, agora,
                     agora + prazo))
            except sqlite3.IntegrityError:
                raise ErroHttp(409, "correlacao_repetida", "Já existe um pedido com esse correlation_id.") from None
            pid = cur.lastrowid
            mid = mensagem_sistema(con, sala, f"🔁 **{de}** pediu o fluxo `{nome}@{versao}` a @{agente} [[pedido:{pid}]]")
            con.execute("UPDATE fluxo_pedido SET msg_id=? WHERE id=?", (mid, pid))
            registrar_evento(con, "pedido", sala, pid)
            p = self._pedido(con, pid, Quem(None, True))
        notificar()
        self._json(201, p)

    def pedidos_fluxo(self, q: dict) -> None:
        """Para o executor: `agente=<eu>&estado=pendente`. Quem não é admin só vê pedidos seus (feitos ou recebidos)."""
        filtros, args = [], []
        for campo in ("agente", "de", "estado", "sala"):
            if q.get(campo):
                filtros.append(f"{campo}=?")
                args.append(q[campo])
        filtros.append("id>?")
        args.append(int(q.get("depois") or 0))
        with conectar() as con:
            quem = self._quem(con)
            self._expirar_pedidos(con)
            if not quem.admin:
                filtros.append("(de=? OR agente=?)")
                args += [quem.nome, quem.nome]
            linhas = con.execute(f"SELECT {COLS_PEDIDO} FROM fluxo_pedido WHERE {' AND '.join(filtros)} "
                                 f"ORDER BY id LIMIT {LIMITE_PAGINA}", args).fetchall()
        self._json(200, [pedido_para_json(r) for r in linhas])

    def ver_pedido(self, pid: int) -> None:
        with conectar() as con:
            quem = self._quem(con)
            self._expirar_pedidos(con)
            p = self._pedido(con, pid, quem)
        self._json(200, p)

    def mudar_pedido(self, pid: int) -> None:
        """Executor do agente pedido: aceito|recusado (de pendente), concluido|falhou (de aceito).
        Quem pediu pode cancelar enquanto não terminou."""
        c = self._corpo()
        estado = c.get("estado")
        resultado, motivo = c.get("resultado"), str(c.get("motivo") or "")[:500]
        if estado not in TRANSICOES_PEDIDO:
            raise ErroHttp(400, "estado_invalido", f"estado: {', '.join(TRANSICOES_PEDIDO)}.")
        texto_res = None
        if resultado is not None:
            if not isinstance(resultado, dict):
                raise ErroHttp(400, "resultado_invalido", "`resultado` deve ser um objeto.")
            texto_res = json.dumps(resultado, ensure_ascii=False)
            if len(texto_res) > 16_000:
                raise ErroHttp(413, "resultado_grande", "Resultado grande demais (máx. 16 KB); anexe arquivos na sala.")
        if CREDENCIAL_RE.search((texto_res or "") + motivo):
            raise ErroHttp(422, "credencial_detectada", "O resultado parece conter uma credencial. Não foi salvo.")
        with conectar() as con:
            quem = self._quem(con)
            self._expirar_pedidos(con)
            p = self._pedido(con, pid, quem)
            de_onde, quem_pode = TRANSICOES_PEDIDO[estado]
            if p["estado"] not in de_onde:
                raise ErroHttp(409, "pedido_decidido", f"O pedido está {p['estado']}; não vai para {estado}.")
            if not quem.admin and quem.nome != p[quem_pode]:
                raise ErroHttp(403, "proibido", f"Só {p[quem_pode]} muda este pedido para {estado}.")
            con.execute("UPDATE fluxo_pedido SET estado=?, resultado=COALESCE(?, resultado), motivo=?, atualizado=? "
                        "WHERE id=?", (estado, texto_res, motivo or None, time.time(), pid))
            icone = {"aceito": "▶️", "recusado": "🚫", "concluido": "✅", "falhou": "❌", "cancelado": "↩️"}[estado]
            resumo = f": {motivo}" if motivo else ""
            mensagem_sistema(con, p["sala"], f"{icone} Pedido [[pedido:{pid}]] `{p['nome']}@{p['versao']}` "
                                             f"de **{p['de']}** → **{p['agente']}**: {estado}{resumo}")
            registrar_evento(con, "pedido", p["sala"], pid)
            p = self._pedido(con, pid, Quem(None, True))
        notificar()
        self._json(200, p)


COLS_PEDIDO = ("id, sala, de, agente, nome, versao, expect_sha256, params, cadeia, correlation_id, estado, resultado, "
               "motivo, criado, atualizado, expira")
# estado novo -> (estados de onde pode vir, campo de quem pode mudar)
TRANSICOES_PEDIDO = {"aceito": (("pendente",), "agente"), "recusado": (("pendente",), "agente"),
                     "concluido": (("aceito",), "agente"), "falhou": (("aceito",), "agente"),
                     "cancelado": (("pendente", "aceito"), "de")}


def pedido_para_json(r: tuple) -> dict:
    (i, sala, de, agente, nome, versao, expect, params, cadeia, correlacao, estado, resultado, motivo, criado,
     atualizado, expira) = r
    return {"id": i, "sala": sala, "de": de, "agente": agente, "nome": nome, "versao": versao,
            "expect_sha256": expect, "params": json.loads(params), "chain": json.loads(cadeia),
            "correlation_id": correlacao, "estado": estado, "resultado": json.loads(resultado) if resultado else None,
            "motivo": motivo, "criado_em": iso(criado), "atualizado_em": iso(atualizado), "expira_em": iso(expira)}


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
                    if con.execute("DELETE FROM msg WHERE criado<?", (limite,)).rowcount:
                        con.execute("INSERT INTO msg_busca(msg_busca) VALUES('rebuild')")
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
