"""Kanban fase 1: prioridade, estimativa, prazo, ordem, etiquetas, checklist e atividade.

Usa o mesmo servidor de teste do test_fatos (banco temporário).
"""
import unittest

from test_fatos import pedir, rs


def tarefa(sala: str, **campos: object) -> dict:
    status, t = pedir("POST", "/tarefas", {"sala": sala, "de": "ana", "titulo": "Fazer o login", **campos})
    assert status == 201, t
    return t


class TestTarefas(unittest.TestCase):
    def test_cria_com_campos_novos(self) -> None:
        t = tarefa("k1", prioridade="alta", estimativa=3, prazo="2026-11-05", etiquetas=["front", "Front", "bug"],
                   descricao="## Passos\n- [ ] tela")
        self.assertEqual((t["prioridade"], t["estimativa"]), ("alta", 3))
        self.assertTrue(t["prazo"].startswith("2026-11-05"))
        self.assertEqual(sorted(e["nome"] for e in t["etiquetas"]), ["bug", "front"])  # sem duplicar por caixa
        self.assertEqual(t["checklist"], {"feitos": 0, "total": 0})
        self.assertEqual(t["atividade"][-1]["campo"], "criada")

    def test_valida_campos(self) -> None:
        casos = {"prioridade": ("altissima", "prioridade_invalida"), "estimativa": (4, "estimativa_invalida"),
                 "prazo": ("amanhã", "prazo_invalido"), "titulo": ("", "titulo_invalido"),
                 "ordem": ("1", "ordem_invalida"), "descricao": ("x" * 20_001, "descricao_invalida")}
        t = tarefa("k2")
        for campo, (valor, codigo) in casos.items():
            status, r = pedir("PATCH", f"/tarefas/{t['id']}", {"de": "ana", campo: valor})
            self.assertEqual((status, r["codigo"]), (400, codigo), campo)
        status, r = pedir("PATCH", f"/tarefas/{t['id']}", {"de": "ana", "etiquetas": ["x"] * 11})
        self.assertEqual(r["codigo"], "etiquetas_invalidas")

    def test_atividade_registra_so_o_que_mudou(self) -> None:
        t = tarefa("k3")
        pedir("PATCH", f"/tarefas/{t['id']}", {"de": "bia", "prioridade": "urgente", "status": "a_fazer"})
        _, r = pedir("PATCH", f"/tarefas/{t['id']}", {"de": "bia", "prioridade": "urgente"})  # nada novo
        campos = [a["campo"] for a in r["atividade"]]
        self.assertEqual(campos.count("prioridade"), 1)
        self.assertNotIn("status", campos)
        mudanca = next(a for a in r["atividade"] if a["campo"] == "prioridade")
        self.assertEqual((mudanca["de"], mudanca["antes"], mudanca["depois"]), ("bia", "nenhuma", "urgente"))

    def test_filtros_e_ordem_da_fila(self) -> None:
        baixa = tarefa("k4", titulo="baixa", prioridade="baixa")
        urgente = tarefa("k4", titulo="urgente", prioridade="urgente", etiquetas=["back"])
        manual = tarefa("k4", titulo="manual", prioridade="nenhuma", ordem=1)
        _, todas = pedir("GET", "/tarefas?sala=k4")
        self.assertEqual([x["id"] for x in todas], [manual["id"], urgente["id"], baixa["id"]])
        _, so_back = pedir("GET", "/tarefas?sala=k4&etiqueta=BACK")
        self.assertEqual([x["id"] for x in so_back], [urgente["id"]])
        _, busca = pedir("GET", "/tarefas?sala=k4&q=urg")
        self.assertEqual([x["id"] for x in busca], [urgente["id"]])
        _, pct = pedir("GET", "/tarefas?sala=k4&q=" + "%25")  # % literal não vira curinga
        self.assertEqual(pct, [])
        status, r = pedir("GET", "/tarefas?sala=k4&prioridade=x")
        self.assertEqual((status, r["codigo"]), (400, "prioridade_invalido"))

    def test_checklist(self) -> None:
        t = tarefa("k5")
        _, t = pedir("POST", f"/tarefas/{t['id']}/checklist", {"de": "ana", "texto": "tela de login"})
        _, t = pedir("POST", f"/tarefas/{t['id']}/checklist", {"de": "ana", "texto": "testes"})
        primeiro = t["itens"][0]
        _, t = pedir("PATCH", f"/tarefas/{t['id']}/checklist/{primeiro['id']}", {"de": "ana", "feito": True})
        self.assertEqual(t["checklist"], {"feitos": 1, "total": 2})
        _, lista = pedir("GET", "/tarefas?sala=k5")
        self.assertEqual(lista[0]["checklist"], {"feitos": 1, "total": 2})
        status, t = pedir("DELETE", f"/tarefas/{t['id']}/checklist/{primeiro['id']}", {"de": "ana"})
        self.assertEqual((status, t["checklist"]), (200, {"feitos": 0, "total": 1}))
        outra = tarefa("k5")
        status, r = pedir("PATCH", f"/tarefas/{outra['id']}/checklist/{t['itens'][0]['id']}", {"de": "ana", "feito": True})
        self.assertEqual((status, r["codigo"]), (404, "item_inexistente"))  # item de outra tarefa

    def test_checklist_tem_limite(self) -> None:
        t = tarefa("k6")
        for i in range(rs.MAX_CHECKLIST):
            pedir("POST", f"/tarefas/{t['id']}/checklist", {"de": "ana", "texto": f"item {i}"})
        status, r = pedir("POST", f"/tarefas/{t['id']}/checklist", {"de": "ana", "texto": "demais"})
        self.assertEqual((status, r["codigo"]), (409, "checklist_cheio"))

    def test_etiquetas_da_sala(self) -> None:
        a = tarefa("k7", etiquetas=["front"])
        tarefa("k7", etiquetas=["front", "infra"])
        _, ets = pedir("GET", "/etiquetas?sala=k7")
        self.assertEqual({e["nome"]: e["tarefas"] for e in ets}, {"front": 2, "infra": 1})
        front = next(e for e in ets if e["nome"] == "front")
        self.assertEqual(pedir("PATCH", f"/etiquetas/{front['id']}", {"cor": 9})[1]["codigo"], "etiqueta_invalida")
        infra = next(e for e in ets if e["nome"] == "infra")
        self.assertEqual(pedir("PATCH", f"/etiquetas/{front['id']}", {"nome": "INFRA"})[1]["codigo"], "etiqueta_em_uso")
        pedir("DELETE", f"/etiquetas/{infra['id']}", None)
        _, ets = pedir("GET", "/etiquetas?sala=k7")
        self.assertEqual([e["nome"] for e in ets], ["front"])
        _, t = pedir("GET", f"/tarefas/{a['id']}")
        self.assertEqual([e["nome"] for e in t["etiquetas"]], ["front"])

    def test_apagar_leva_junto_checklist_e_etiquetas(self) -> None:
        t = tarefa("k8", etiquetas=["x"])
        pedir("POST", f"/tarefas/{t['id']}/checklist", {"de": "ana", "texto": "a"})
        pedir("DELETE", f"/tarefas/{t['id']}", None)
        con = rs.conectar()
        try:
            for tabela in ("checklist", "tarefa_etiqueta", "atividade"):
                n = con.execute(f"SELECT COUNT(*) FROM {tabela} WHERE tarefa_id=?", (t["id"],)).fetchone()[0]
                self.assertEqual(n, 0, tabela)
        finally:
            con.close()

    def test_ata_ainda_cria_tarefas(self) -> None:
        _, r = pedir("POST", "/reunioes", {"sala": "k9", "de": "jose", "participantes": ["jose"]})
        status, r = pedir("POST", f"/reunioes/{r['id']}/encerrar",
                          {"de": "jose", "ata": "x", "acoes": [{"titulo": "deploy", "responsavel": "jose"}]})
        self.assertEqual(status, 200, r)
        _, lista = pedir("GET", "/tarefas?sala=k9")
        self.assertEqual((lista[0]["titulo"], lista[0]["prioridade"]), ("deploy", "nenhuma"))


if __name__ == "__main__":
    unittest.main()
