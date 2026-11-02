"""Pilha de tarefas por agente e a conciliação com os pedidos de fluxo (docs/PLANO-PILHA.md).

Usa o mesmo servidor de teste do test_fatos (banco temporário).
"""
import unittest

from test_fatos import pedir, rs, token
from test_fluxos import fluxo


def tarefa(sala: str, titulo: str, responsavel: str | None, tk: str = "admin-de-teste", **extra: object) -> dict:
    rs.ENVIOS.estado.clear()
    status, t = pedir("POST", "/tarefas", {"sala": sala, "de": "lume", "titulo": titulo, "responsavel": responsavel, **extra},
                      token=tk)
    assert status == 201, t
    return t


def pilha(agente: str, tk: str = "admin-de-teste", **q: str) -> list[dict]:
    extra = "".join(f"&{k}={v}" for k, v in q.items())
    status, r = pedir("GET", f"/pilha?agente={agente}{extra}", token=tk)
    assert status == 200, r
    return r["itens"]


def titulos(itens: list[dict]) -> list[str]:
    return [i["titulo"] for i in itens]


class TestPilha(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.t_bot = token("bot-pilha", "ia")
        cls.t_outra = token("outra-ia-pilha", "ia")
        cls.t_jo = token("jo-pilha", "humano")

    def test_junta_salas_e_ordena(self) -> None:
        tarefa("pl1", "A", "bot-pilha")
        tarefa("pl2", "B", "bot-pilha", prioridade="urgente")
        tarefa("pl1", "C", "bot-pilha")
        tarefa("pl1", "de outro", "jo-pilha")
        feita = tarefa("pl1", "feita", "bot-pilha")
        pedir("PATCH", f"/tarefas/{feita['id']}", {"status": "feito", "de": "lume"})
        # Sem posição manual: prioridade, depois a mais antiga. Feito não entra; outras salas entram.
        self.assertEqual(titulos(pilha("bot-pilha")), ["B", "A", "C"])
        self.assertEqual(titulos(pilha("bot-pilha", sala="pl1")), ["A", "C"])
        self.assertEqual([i["posicao"] for i in pilha("bot-pilha")], [1, 2, 3])

    def test_mover_e_topo(self) -> None:
        a = tarefa("pl3", "a", "mov-pilha")
        b = tarefa("pl3", "b", "mov-pilha")
        c = tarefa("pl3", "c", "mov-pilha")
        status, r = pedir("POST", "/pilha/mover", {"tarefa": c["id"], "topo": True})
        self.assertEqual(status, 200, r)
        self.assertEqual(titulos(r["itens"]), ["c", "a", "b"])
        _, r = pedir("POST", "/pilha/mover", {"tarefa": c["id"], "depois_de": a["id"]})
        self.assertEqual(titulos(r["itens"]), ["a", "c", "b"])
        _, r = pedir("POST", "/pilha/mover", {"tarefa": a["id"], "fundo": True})
        self.assertEqual(titulos(r["itens"]), ["c", "b", "a"])
        _, r = pedir("POST", "/pilha/mover", {"tarefa": a["id"], "antes_de": c["id"]})
        self.assertEqual(titulos(r["itens"]), ["a", "c", "b"])
        status, r = pedir("POST", "/pilha/mover", {"tarefa": b["id"], "antes_de": 999999})
        self.assertEqual((status, r["codigo"]), (400, "referencia_invalida"))
        # Urgente na criação entra no topo.
        tarefa("pl3", "urgente", "mov-pilha", topo=True)
        self.assertEqual(titulos(pilha("mov-pilha"))[0], "urgente")

    def test_quem_pode_mexer(self) -> None:
        t = tarefa("pl4", "minha", "bot-pilha")
        status, r = pedir("POST", "/pilha/mover", {"tarefa": t["id"], "topo": True}, token=self.t_outra)
        self.assertEqual((status, r["codigo"]), (403, "proibido"))
        self.assertEqual(pedir("POST", "/pilha/mover", {"tarefa": t["id"], "topo": True}, token=self.t_bot)[0], 200)
        self.assertEqual(pedir("POST", "/pilha/mover", {"tarefa": t["id"], "fundo": True}, token=self.t_jo)[0], 200)
        status, r = pedir("POST", "/pilha/proxima", {"agente": "bot-pilha"}, token=self.t_outra)
        self.assertEqual(status, 403)

    def test_proxima(self) -> None:
        t_ia = token("prox-pilha", "ia")
        self.assertEqual(pedir("POST", "/pilha/proxima", {}, token=t_ia)[1], {"tarefa": None, "ja_fazendo": False})
        primeira = tarefa("pl5", "primeira", "prox-pilha")
        tarefa("pl5", "segunda", "prox-pilha")
        status, r = pedir("POST", "/pilha/proxima", {}, token=t_ia)
        self.assertEqual((status, r["tarefa"]["id"], r["tarefa"]["status"], r["ja_fazendo"]),
                         (200, primeira["id"], "fazendo", False))
        _, r = pedir("POST", "/pilha/proxima", {}, token=t_ia)
        self.assertEqual((r["tarefa"]["id"], r["ja_fazendo"]), (primeira["id"], True))  # uma de cada vez

    def test_trocar_responsavel_vai_para_o_fim(self) -> None:
        tarefa("pl6", "x", "dono-novo-pilha")
        t = tarefa("pl6", "y", "dono-velho-pilha", topo=True)
        pedir("PATCH", f"/tarefas/{t['id']}", {"responsavel": "dono-novo-pilha", "de": "lume"})
        self.assertEqual(titulos(pilha("dono-novo-pilha")), ["x", "y"])
        self.assertEqual(pilha("dono-velho-pilha"), [])


class TestPilhaComFluxos(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.t_ana = token("ana-pf", "humano")
        cls.t_bot = token("bot-pf", "ia")
        rs.ENVIOS.estado.clear()
        status, r = pedir("POST", "/fluxos", {"sala": "pf", "fluxo": fluxo()}, token=cls.t_ana)
        assert status == 201, r

    def pedir_fluxo(self, **extra: object) -> dict:
        rs.ENVIOS.estado.clear()
        corpo = {"sala": "pf", "agente": "bot-pf", "nome": "test-pr", "versao": 4, "params": {"pr": 7}, **extra}
        status, p = pedir("POST", "/fluxos/pedidos", corpo, token=self.t_ana)
        self.assertEqual(status, 201, p)
        return p

    def item_do_pedido(self, pid: int) -> dict | None:
        return next((i for i in pilha("bot-pf") if i["pedido"] and i["pedido"]["id"] == pid), None)

    def test_pedido_vira_tarefa_e_segue_o_estado(self) -> None:
        p = self.pedir_fluxo(prioridade="alta")
        item = self.item_do_pedido(p["id"])
        self.assertIsNotNone(item)
        self.assertEqual((item["status"], item["prioridade"], item["sala"]), ("a_fazer", "alta", "pf"))
        self.assertIn("test-pr@4", item["titulo"])
        self.assertEqual(item["pedido"]["estado"], "pendente")
        pedir("POST", f"/fluxos/pedidos/{p['id']}/estado", {"estado": "aceito"}, token=self.t_bot)
        self.assertEqual(self.item_do_pedido(p["id"])["status"], "fazendo")
        pedir("POST", f"/fluxos/pedidos/{p['id']}/estado", {"estado": "falhou", "motivo": "npm ci"}, token=self.t_bot)
        item = self.item_do_pedido(p["id"])
        self.assertEqual(item["status"], "revisao")
        _, completa = pedir("GET", f"/tarefas/{item['id']}")
        self.assertTrue(any(a["campo"] == "pedido" and "falhou: npm ci" in str(a["depois"]) for a in completa["atividade"]))

    def test_concluido_e_cancelado_saem_da_pilha(self) -> None:
        p1, p2 = self.pedir_fluxo(), self.pedir_fluxo()
        pedir("POST", f"/fluxos/pedidos/{p1['id']}/estado", {"estado": "aceito"}, token=self.t_bot)
        pedir("POST", f"/fluxos/pedidos/{p1['id']}/estado", {"estado": "concluido"}, token=self.t_bot)
        pedir("POST", f"/fluxos/pedidos/{p2['id']}/estado", {"estado": "cancelado"}, token=self.t_ana)
        self.assertIsNone(self.item_do_pedido(p1["id"]))
        self.assertIsNone(self.item_do_pedido(p2["id"]))

    def test_executor_le_na_ordem_da_pilha(self) -> None:
        primeiro, segundo = self.pedir_fluxo(), self.pedir_fluxo()
        t2 = self.item_do_pedido(segundo["id"])
        pedir("POST", "/pilha/mover", {"tarefa": t2["id"], "topo": True}, token=self.t_bot)
        _, por_chegada = pedir("GET", "/fluxos/pedidos?agente=bot-pf&estado=pendente", token=self.t_bot)
        _, por_pilha = pedir("GET", "/fluxos/pedidos?agente=bot-pf&estado=pendente&ordem=pilha", token=self.t_bot)
        ids_chegada = [p["id"] for p in por_chegada]
        ids_pilha = [p["id"] for p in por_pilha]
        self.assertLess(ids_chegada.index(primeiro["id"]), ids_chegada.index(segundo["id"]))
        self.assertLess(ids_pilha.index(segundo["id"]), ids_pilha.index(primeiro["id"]))
        self.assertEqual(sorted(ids_chegada), sorted(ids_pilha))

    def test_proxima_nao_pega_pedido(self) -> None:
        t = token("so-fluxo-pf", "ia")
        rs.ENVIOS.estado.clear()
        pedir("POST", "/fluxos/pedidos", {"sala": "pf", "agente": "so-fluxo-pf", "nome": "test-pr", "versao": 4,
                                          "params": {}}, token=self.t_ana)
        self.assertIsNone(pedir("POST", "/pilha/proxima", {}, token=t)[1]["tarefa"])

    def test_tarefa_existente_roda_por_fluxo(self) -> None:
        t = tarefa("pf", "Rodar a suíte do PR 7", "jo-pf", tk=self.t_ana)
        rs.ENVIOS.estado.clear()
        status, p = pedir("POST", f"/tarefas/{t['id']}/fluxo", {"agente": "bot-pf", "nome": "test-pr", "versao": 4,
                                                               "params": {"pr": 7}}, token=self.t_ana)
        self.assertEqual(status, 201, p)
        item = self.item_do_pedido(p["id"])
        self.assertEqual((item["id"], item["titulo"], item["responsavel"]), (t["id"], "Rodar a suíte do PR 7", "bot-pf"))
        status, r = pedir("POST", f"/tarefas/{t['id']}/fluxo", {"agente": "bot-pf", "nome": "test-pr", "versao": 4},
                          token=self.t_ana)
        self.assertEqual((status, r["codigo"]), (409, "tarefa_com_pedido"))

    def test_prioridade_invalida(self) -> None:
        rs.ENVIOS.estado.clear()
        status, r = pedir("POST", "/fluxos/pedidos", {"sala": "pf", "agente": "bot-pf", "nome": "test-pr", "versao": 4,
                                                      "prioridade": "agora"}, token=self.t_ana)
        self.assertEqual((status, r["codigo"]), (400, "prioridade_invalida"))


if __name__ == "__main__":
    unittest.main()
