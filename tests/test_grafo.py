"""Memória fase 6: normalização, aliases (com a trava para agentes) e o grafo de vizinhança.

Usa o mesmo servidor de teste do test_fatos (banco temporário).
"""
import os
import sqlite3
import unittest
import urllib.parse

from test_fatos import PASTA, mensagem, pedir, rs, token


def fato(sala: str, sujeito: str, predicado: str, objeto: str, de: str = "lume") -> dict:
    rs.ENVIOS.estado.clear()  # os testes criam dezenas de fatos seguidos; o limite de taxa não é o assunto aqui
    rs.FATOS.estado.clear()
    origem = mensagem(sala, f"{sujeito} {predicado} {objeto}")
    status, f = pedir("POST", "/fatos", {"sala": sala, "de": de, "sujeito": sujeito, "predicado": predicado,
                                         "objeto": objeto, "origem_tipo": "msg", "origem_id": str(origem)})
    assert status == 201, f
    return f


def grafo(sala: str, **q: str) -> dict:
    status, g = pedir("GET", "/memoria/grafo?" + urllib.parse.urlencode({"sala": sala, **q}))
    assert status == 200, g
    return g


HUMANO = None


def humano() -> str:
    global HUMANO
    if HUMANO is None:
        HUMANO = token("bruna", "humano")
    return HUMANO


class TestGrafo(unittest.TestCase):
    def setUp(self) -> None:
        rs.FATOS.estado.clear()
        rs.ENVIOS.estado.clear()

    def test_normalizacao_junta_caixa_e_acento_sem_alias(self) -> None:
        fato("g1", "Relay", "usa", "SSE")
        fato("g1", "relay", "guarda em", "SQLite")
        fato("g1", "Reunião", "acontece", "às 9h")
        _, achados = pedir("GET", "/fatos?sala=g1&sujeito=RELAY")
        self.assertEqual(len(achados), 2)
        _, achados = pedir("GET", "/fatos?sala=g1&sujeito=reuniao")
        self.assertEqual(len(achados), 1)

    def test_artigo_nao_e_tirado_sozinho_e_vira_sugestao(self) -> None:
        fato("g2", "o relay", "usa", "SSE")
        fato("g2", "relay", "usa", "FTS5")
        fato("g2", "relay", "roda em", "Tailscale")
        fato("g2", "A Fazer", "é", "coluna do quadro")
        fato("g2", "fazer", "é", "verbo")
        _, achados = pedir("GET", "/fatos?sala=g2&sujeito=relay")
        self.assertEqual(len(achados), 2)  # "o relay" continua separado
        _, sugestoes = pedir("GET", "/memoria/aliases/sugestoes?sala=g2")
        pares = {(s["nome"], s["canonico"]) for s in sugestoes}
        self.assertIn(("o relay", "relay"), pares)  # sugerido, não juntado
        _, so_fazer = pedir("GET", "/fatos?sala=g2&sujeito=fazer")
        self.assertEqual([f["objeto"] for f in so_fazer], ["verbo"])

    def test_alias_junta_na_leitura_e_apagar_separa(self) -> None:
        fato("g3", "relay", "usa", "SSE")
        fato("g3", "relay-mcp", "expõe", "buscar_memoria")
        status, a = pedir("POST", "/memoria/aliases", {"sala": "g3", "nome": "relay-mcp", "canonico": "relay"},
                          token=humano())
        self.assertEqual((status, a["estado"]), (201, "vigente"))
        _, achados = pedir("GET", "/fatos?sala=g3&sujeito=relay")
        self.assertEqual(len(achados), 2)
        _, achados = pedir("GET", "/fatos?sala=g3&sujeito=Relay-MCP")
        self.assertEqual(len(achados), 2)
        status, _ = pedir("DELETE", "/memoria/aliases?sala=g3&nome=relay-mcp", None, token=humano())
        self.assertEqual(status, 204)
        _, achados = pedir("GET", "/fatos?sala=g3&sujeito=relay")
        self.assertEqual(len(achados), 1)  # nenhum fato some; o nó só volta a se separar

    def test_regras_de_alias(self) -> None:
        fato("g4", "relay", "usa", "SSE")
        h = humano()
        pedir("POST", "/memoria/aliases", {"sala": "g4", "nome": "relay-mcp", "canonico": "relay"}, token=h)
        # alias para um alias grava a raiz (sem cadeia)
        _, a = pedir("POST", "/memoria/aliases", {"sala": "g4", "nome": "rmcp", "canonico": "relay-mcp"}, token=h)
        self.assertEqual(a["canonico"], "relay")
        # o nó de outros aliases não pode virar alias (evita A→B e B→A)
        status, r = pedir("POST", "/memoria/aliases", {"sala": "g4", "nome": "relay", "canonico": "outro"}, token=h)
        self.assertEqual((status, r["codigo"]), (409, "alias_e_canonico"))
        status, r = pedir("POST", "/memoria/aliases", {"sala": "g4", "nome": "RELAY", "canonico": "relay"}, token=h)
        self.assertEqual((status, r["codigo"]), (400, "alias_igual"))
        status, r = pedir("POST", "/memoria/aliases", {"sala": "g4", "nome": "relay-mcp", "canonico": "x"}, token=h)
        self.assertEqual((status, r["codigo"]), (409, "alias_existe"))

    def test_trava_de_agente(self) -> None:
        for i in range(rs.ALIAS_TRAVA_FATOS):
            fato("g5", "relay", "tem", f"item {i}")
        fato("g5", "app", "usa", "Compose")
        fato("g5", "web", "usa", "React")
        # agente juntando num nó grande vira candidato
        _, a = pedir("POST", "/memoria/aliases", {"sala": "g5", "de": "claude-x", "nome": "relay-mcp", "canonico": "relay"})
        self.assertEqual(a["estado"], "candidato")
        _, achados = pedir("GET", "/fatos?sala=g5&sujeito=relay-mcp")
        self.assertEqual(achados, [])  # candidato ainda não junta
        # agente juntando um nome que tem fatos próprios também vira candidato
        _, b = pedir("POST", "/memoria/aliases", {"sala": "g5", "de": "claude-x", "nome": "app", "canonico": "web"})
        self.assertEqual(b["estado"], "candidato")
        # agente juntando um nome novo num nó pequeno grava direto
        _, c = pedir("POST", "/memoria/aliases", {"sala": "g5", "de": "claude-x", "nome": "frontend", "canonico": "web"})
        self.assertEqual(c["estado"], "vigente")
        # só humano decide o candidato; admin+de não conta
        status, r = pedir("POST", "/memoria/aliases/decidir", {"sala": "g5", "nome": "relay-mcp", "acao": "confirmar", "de": "jose"})
        self.assertEqual((status, r["codigo"]), (403, "requer_humano"))
        status, _ = pedir("POST", "/memoria/aliases/decidir", {"sala": "g5", "nome": "relay-mcp", "acao": "confirmar"}, token=humano())
        self.assertEqual(status, 204)
        _, lista = pedir("GET", "/memoria/aliases?sala=g5")
        confirmado = next(x for x in lista if x["nome"] == "relay-mcp")
        self.assertEqual((confirmado["estado"], confirmado["confirmado_por"]), ("vigente", "bruna"))

    def test_grafo_vizinhanca_nos_dois_sentidos(self) -> None:
        fato("g6", "relay", "usa", "SSE")
        fato("g6", "relay", "é responsabilidade de", "José")
        fato("g6", "app Android", "depende de", "relay")
        fato("g6", "SSE", "roda sobre", "HTTP")
        fato("g6", "José", "mora em", "Minas")
        g = grafo("g6", sujeito="Relay")
        self.assertEqual(g["centro"], "relay")
        # Entre nós, a aresta usa a chave do nó (normalizada); numa folha, o texto como foi registrado.
        pares = {(a["de"], a["para"], a["folha"]) for a in g["arestas"]}
        self.assertIn(("relay", "sse", False), pares)          # SSE também é sujeito: é nó
        self.assertIn(("relay", "jose", False), pares)
        self.assertIn(("app android", "relay", False), pares)  # entrando no centro
        self.assertNotIn(("sse", "HTTP", True), pares)         # profundidade 1 não vai além
        rotulos = {n["nome"]: n["rotulo"] for n in g["nos"]}
        self.assertEqual(rotulos["jose"], "José")              # o web mostra o rótulo, não a chave
        g2 = grafo("g6", sujeito="relay", profundidade="2")
        pares2 = {(a["de"], a["para"], a["folha"]) for a in g2["arestas"]}
        self.assertIn(("sse", "HTTP", True), pares2)
        self.assertIn(("jose", "Minas", True), pares2)

    def test_grafo_corta_em_50_e_ignora_superados_e_candidatos(self) -> None:
        for i in range(rs.GRAFO_MAX_ARESTAS + 5):
            fato("g7", "relay", "tem", f"item {i}")
        g = grafo("g7", sujeito="relay")
        self.assertEqual((len(g["arestas"]), g["cortado"]), (rs.GRAFO_MAX_ARESTAS, True))
        velho = fato("g8", "relay", "usa", "polling")
        origem = mensagem("g8", "trocamos")
        pedir("POST", "/fatos", {"sala": "g8", "de": "lume", "sujeito": "relay", "predicado": "usa", "objeto": "SSE",
                                 "origem_tipo": "msg", "origem_id": str(origem), "supera": velho["id"]})
        g = grafo("g8", sujeito="relay")
        self.assertEqual([a["para"] for a in g["arestas"]], ["SSE"])

    def test_grafo_do_agente(self) -> None:
        fato("g9", "claude-joao", "cuida de", "back")
        fato("g9", "Claudio", "revisa", "PRs")              # pelo apelido de exibição
        fato("g9", "relay", "usa", "FTS5", de="claude-joao")  # registrado por ele
        fato("g9", "web", "usa", "React", de="lume")          # nada a ver com ele
        rs_con = rs.conectar()
        try:
            rs_con.execute("INSERT OR REPLACE INTO apelido VALUES ('claude-joao','Claudio','claude-joao',1)")
            rs_con.commit()
        finally:
            rs_con.close()
        g = grafo("g9", centro="agente:claude-joao")
        objetos = {a["para"] for a in g["arestas"]}
        self.assertEqual(objetos, {"back", "PRs", "FTS5"})

    def test_migracao_14_para_15_normaliza_fatos_antigos(self) -> None:
        caminho = os.path.join(PASTA, "antigo-14.sqlite")
        con = sqlite3.connect(caminho)
        for sql in rs.MIGRACOES[:14]:
            for comando in filter(str.strip, sql.split(";")):
                con.execute(comando)
        con.execute("PRAGMA user_version=14")
        con.execute("INSERT INTO fato (sala, sujeito, predicado, objeto, origem_tipo, origem_id, autor, criado) "
                    "VALUES ('s','Reunião','é','às 9h','msg','1','x',1)")
        con.commit()
        con.close()
        anterior, rs.DB = rs.DB, caminho
        try:
            rs.migrar()
            con = sqlite3.connect(caminho)
            self.assertEqual(con.execute("SELECT sujeito_norm, objeto_norm FROM fato").fetchall(), [("reuniao", "as 9h")])
            con.close()
        finally:
            rs.DB = anterior


if __name__ == "__main__":
    unittest.main()
