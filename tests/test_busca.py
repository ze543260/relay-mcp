"""Fase 2 do web (busca e navegação): /mensagens/busca, /mensagens/{id}/contexto, não lidas no /salas e /busca."""
import unittest

from test_fatos import mensagem, pedir, rs, token


def postar(sala: str, texto: str, tk: str, para: str | None = None) -> int:
    corpo = {"sala": sala, "texto": texto, **({"para": para} if para else {})}
    status, r = pedir("POST", "/mensagens", corpo, token=tk)
    assert status == 201, r
    return r["id"]


class TestBusca(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ana, cls.bia, cls.eve = token("ana-bx", "humano"), token("bia-bx", "humano"), token("eve-bx", "ia")

    def setUp(self) -> None:
        rs.ENVIOS.estado.clear()  # o limite de envio (30/min) não é o assunto destes testes

    def test_busca_acha_e_respeita_privadas(self) -> None:
        postar("bx1", "A reunião de planejamento é amanhã", self.ana)
        postar("bx1", "planejamento secreto só pra bia", self.ana, para="bia-bx")
        _, r = pedir("GET", "/mensagens/busca?sala=bx1&q=planej", token=self.bia)
        self.assertEqual(len(r["mensagens"]), 2)
        _, r = pedir("GET", "/mensagens/busca?sala=bx1&q=planej", token=self.eve)
        self.assertEqual([m["texto"] for m in r["mensagens"]], ["A reunião de planejamento é amanhã"])
        _, r = pedir("GET", "/mensagens/busca?sala=bx1&q=reuniao", token=self.eve)  # sem acento também acha
        self.assertEqual(len(r["mensagens"]), 1)
        self.assertEqual(r["mensagens"][0]["sala"], "bx1")

    def test_busca_acompanha_edicao_e_apagamento(self) -> None:
        mid = postar("bx2", "texto original abacaxi", self.ana)
        pedir("PATCH", f"/mensagens/{mid}", {"texto": "texto novo laranja"}, token=self.ana)
        _, r = pedir("GET", "/mensagens/busca?sala=bx2&q=abacaxi", token=self.ana)
        self.assertEqual(r["mensagens"], [])
        _, r = pedir("GET", "/mensagens/busca?sala=bx2&q=laranja", token=self.ana)
        self.assertEqual([m["id"] for m in r["mensagens"]], [mid])
        pedir("DELETE", f"/mensagens/{mid}", token=self.ana)
        _, r = pedir("GET", "/mensagens/busca?sala=bx2&q=laranja", token=self.ana)
        self.assertEqual(r["mensagens"], [])

    def test_busca_pagina(self) -> None:
        ids = [postar("bx3", f"item kiwi {i}", self.ana) for i in range(5)]
        _, r = pedir("GET", "/mensagens/busca?sala=bx3&q=kiwi&limite=2", token=self.ana)
        self.assertEqual(([m["id"] for m in r["mensagens"]], r["tem_mais"]), (ids[:2:-1][:2], True))
        _, r = pedir("GET", f"/mensagens/busca?sala=bx3&q=kiwi&limite=10&antes={ids[2]}", token=self.ana)
        self.assertEqual(([m["id"] for m in r["mensagens"]], r["tem_mais"]), ([ids[1], ids[0]], False))
        _, r = pedir("GET", "/mensagens/busca?sala=bx3&q=kiwi%20a%20b", token=self.ana)  # 1 letra é ignorada
        self.assertEqual(len(r["mensagens"]), 5)
        status, r = pedir("GET", "/mensagens/busca?sala=bx3&q=%3B%3B", token=self.ana)
        self.assertEqual((status, r["codigo"]), (400, "busca_vazia"))

    def test_contexto(self) -> None:
        ids = [postar("bx4", f"m{i}", self.ana) for i in range(7)]
        privada = postar("bx4", "só bia", self.ana, para="bia-bx")
        _, r = pedir("GET", f"/mensagens/{ids[3]}/contexto?n=2", token=self.eve)
        self.assertEqual([m["id"] for m in r["mensagens"]], ids[1:6])
        self.assertEqual((r["alvo"], r["sala"], r["tem_antes"], r["tem_depois"]), (ids[3], "bx4", True, True))
        status, _ = pedir("GET", f"/mensagens/{privada}/contexto", token=self.eve)
        self.assertEqual(status, 404)

    def test_nao_lidas_e_mencoes(self) -> None:
        postar("bx5", "oi", self.ana)
        postar("bx5", "@bia-bx olha isso", self.ana)
        postar("bx5", "privada", self.ana, para="bia-bx")
        postar("bx5", "minha", self.bia)  # quem escreve leu até ali
        _, salas = pedir("GET", "/salas", token=self.bia)
        s = next(x for x in salas if x["sala"] == "bx5")
        self.assertEqual((s["nao_lidas"], s["mencoes"]), (0, 0))
        postar("bx5", "depois @bia-bx", self.ana)
        postar("bx5", "depois 2 @bia-bxx", self.ana)  # outro nome: não é menção à bia-bx
        _, salas = pedir("GET", "/salas", token=self.bia)
        s = next(x for x in salas if x["sala"] == "bx5")
        self.assertEqual((s["nao_lidas"], s["mencoes"]), (2, 1))
        _, salas = pedir("GET", "/salas", token=self.eve)
        s = next(x for x in salas if x["sala"] == "bx5")
        self.assertEqual(s["nao_lidas"], 5)  # a privada da bia não conta para a eve

    def test_busca_unificada(self) -> None:
        mensagem("bxu", "o mascote se chama girassol")
        pedir("POST", "/tarefas", {"sala": "bxu", "de": "ana-bx", "titulo": "Girassol no login"})
        pedir("POST", "/artefatos", {"sala": "bxu", "de": "ana-bx", "titulo": "Plano girassol", "tipo": "markdown",
                                     "conteudo": "# x"})
        _, r = pedir("GET", "/busca?q=girassol&sala=bxu", token=self.eve)
        self.assertEqual([t["titulo"] for t in r["tarefas"]], ["Girassol no login"])
        self.assertEqual([a["titulo"] for a in r["artefatos"]], ["Plano girassol"])
        self.assertTrue(any("girassol" in m["texto"] for m in r["mensagens"]))
        _, r = pedir("GET", "/busca?q=bia-b", token=self.eve)
        self.assertIn("bia-bx", [p["nome"] for p in r["pessoas"]])
        _, r = pedir("GET", "/busca?q=bxu", token=self.eve)
        self.assertIn("bxu", r["salas"])
        _, r = pedir("GET", "/busca?q=100%25", token=self.eve)  # % é literal, não curinga
        self.assertEqual(r["tarefas"], [])


if __name__ == "__main__":
    unittest.main()
