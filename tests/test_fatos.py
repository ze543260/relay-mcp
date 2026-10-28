"""Memória da equipe (fase 1): POST/GET /fatos contra um servidor de verdade num banco temporário.

Rodar: python -m unittest discover -s tests
"""
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

PASTA = tempfile.mkdtemp(prefix="relay-teste-")
os.environ["RELAY_DB"] = os.path.join(PASTA, "relay.sqlite")
os.environ["RELAY_ARQUIVOS"] = os.path.join(PASTA, "arquivos")
os.environ["RELAY_TOKEN"] = "admin-de-teste"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import relay_server as rs  # noqa: E402

rs.migrar()
SERVIDOR = rs.Servidor(("127.0.0.1", 0), rs.Handler)
threading.Thread(target=SERVIDOR.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{SERVIDOR.server_address[1]}"


def pedir(metodo: str, caminho: str, corpo: dict | None = None) -> tuple[int, object]:
    req = urllib.request.Request(
        URL + caminho, method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None,
        headers={"Authorization": "Bearer admin-de-teste", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def mensagem(sala: str, texto: str, para: str | None = None) -> int:
    corpo = {"sala": sala, "de": "lume", "texto": texto}
    if para:
        corpo["para"] = para
    status, r = pedir("POST", "/mensagens", corpo)
    assert status == 201, r
    return r["id"]


def fato(sala: str, origem: int, **extra: object) -> tuple[int, dict]:
    corpo = {"sala": sala, "de": "claude-joao", "sujeito": "relay", "predicado": "usa", "objeto": "SSE para tempo real",
             "origem_tipo": "msg", "origem_id": str(origem), **extra}
    return pedir("POST", "/fatos", corpo)


class TestFatos(unittest.TestCase):
    def setUp(self) -> None:
        rs.FATOS.estado.clear()  # o limite de taxa não pode vazar entre testes

    def test_registra_e_busca_com_origem(self) -> None:
        origem = mensagem("t1", "decidido: SSE")
        status, f = fato("t1", origem)
        self.assertEqual(status, 201, f)
        self.assertEqual(f["origem"], {"tipo": "msg", "id": str(origem)})
        self.assertEqual(f["autor"], "claude-joao")
        status, achados = pedir("GET", "/fatos?sala=t1&q=sse")
        self.assertEqual([a["id"] for a in achados], [f["id"]])

    def test_sem_origem_recusa(self) -> None:
        status, r = pedir("POST", "/fatos", {"sala": "t2", "de": "x", "sujeito": "a", "predicado": "b", "objeto": "c"})
        self.assertEqual((status, r["codigo"]), (400, "origem_obrigatoria"))

    def test_origem_inexistente_outra_sala_e_privada(self) -> None:
        self.assertEqual(fato("t3", 999_999)[1]["codigo"], "origem_inexistente")
        de_outra = mensagem("outra", "oi")
        self.assertEqual(fato("t3", de_outra)[1]["codigo"], "origem_outra_sala")
        privada = mensagem("t3", "segredo", para="claude-joao")
        self.assertEqual(fato("t3", privada)[1]["codigo"], "origem_privada")

    def test_ata_so_de_reuniao_encerrada(self) -> None:
        status, r = fato("t4", 1, origem_tipo="ata", origem_id="424242")
        self.assertEqual((status, r["codigo"]), (400, "origem_inexistente"))

    def test_supera_vira_historico(self) -> None:
        origem = mensagem("t5", "agora é WebSocket")
        _, antigo = fato("t5", origem)
        status, novo = fato("t5", origem, objeto="WebSocket para tempo real", supera=antigo["id"])
        self.assertEqual(status, 201, novo)
        _, vigentes = pedir("GET", "/fatos?sala=t5&sujeito=RELAY")
        self.assertEqual([f["id"] for f in vigentes], [novo["id"]])
        _, todos = pedir("GET", "/fatos?sala=t5&historico=1")
        self.assertEqual({f["id"]: f["estado"] for f in todos}, {novo["id"]: "vigente", antigo["id"]: "superado"})
        _, cadeia = pedir("GET", f"/fatos/{novo['id']}")
        self.assertEqual([f["id"] for f in cadeia["versoes_anteriores"]], [antigo["id"]])
        _, velho = pedir("GET", f"/fatos/{antigo['id']}")
        self.assertEqual([f["id"] for f in velho["versoes_seguintes"]], [novo["id"]])

    def test_superar_ja_superado_e_conflito(self) -> None:
        origem = mensagem("t6", "x")
        _, a = fato("t6", origem)
        fato("t6", origem, objeto="v2", supera=a["id"])
        status, r = fato("t6", origem, objeto="v3", supera=a["id"])
        self.assertEqual((status, r["codigo"]), (409, "fato_nao_vigente"))
        # A transação recusada não deixa fato órfão para trás.
        _, todos = pedir("GET", "/fatos?sala=t6&historico=1")
        self.assertEqual(len(todos), 2)

    def test_busca_ignora_acento_e_aceita_prefixo(self) -> None:
        origem = mensagem("t7", "x")
        fato("t7", origem, sujeito="reunião diária", predicado="acontece", objeto="às 9h")
        for termo in ("reuniao", "REUNIÃO", "reun", "diaria"):
            _, achados = pedir("GET", f"/fatos?sala=t7&q={urllib.request.quote(termo)}")
            self.assertEqual(len(achados), 1, termo)

    def test_busca_com_aspas_e_operadores_nao_quebra(self) -> None:
        status, r = pedir("GET", "/fatos?sala=t7&q=" + urllib.request.quote('"OR NEAR( *) AND'))
        self.assertEqual(status, 200, r)

    def test_credencial_recusada(self) -> None:
        origem = mensagem("t8", "x")
        status, r = fato("t8", origem, objeto="token ghp_" + "a" * 36)
        self.assertEqual((status, r["codigo"]), (422, "credencial_detectada"))

    def test_migracao_preserva_dados_existentes(self) -> None:
        caminho = os.path.join(PASTA, "antigo.sqlite")
        con = sqlite3.connect(caminho)
        for sql in rs.MIGRACOES[:9]:
            for comando in filter(str.strip, sql.split(";")):
                con.execute(comando)
        con.execute("PRAGMA user_version=9")
        con.execute("INSERT INTO msg (sala, de, texto, criado) VALUES ('geral', 'jose', 'antiga', 1)")
        con.commit()
        con.close()
        anterior, rs.DB = rs.DB, caminho
        try:
            rs.migrar()
            con = sqlite3.connect(caminho)
            self.assertEqual(con.execute("PRAGMA user_version").fetchone()[0], len(rs.MIGRACOES))
            self.assertEqual(con.execute("SELECT texto FROM msg").fetchall(), [("antiga",)])
            con.execute("SELECT * FROM fato_busca").fetchall()
            con.close()
        finally:
            rs.DB = anterior


if __name__ == "__main__":
    unittest.main()
