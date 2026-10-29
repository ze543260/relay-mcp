"""Workflows (docs/PLANO-FLUXOS.md): esquema, condições, pior caso, hash, catálogo, pedidos e executor.

O executor roda com um sandbox falso (sem Docker) e um agente falso (sem API); o relay é o servidor de teste.
"""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from test_fatos import URL, pedir, token

import relay_executor as rx
import relay_fluxos as rf

BASE = {
    "name": "test-pr", "version": 4, "environment": {"image": "node:22-bookworm"},
    "params": {"repo": {"type": "choice", "from": "approved_repos"}, "pr": {"type": "integer", "min": 1},
               "browsers": {"type": "list", "from": ["chromium", "firefox"], "max": 2}},
    "limits": {"max_steps": 40, "timeout": "20m"},
    "nodes": [
        {"id": "clone", "clone": "{repo}", "ref": "pull/{pr}/head", "next": "install"},
        {"id": "install", "run": ["npm", "ci"], "outputs": {"exit_code": "integer"}, "next": "install_ok"},
        {"id": "install_ok", "if": "install.exit_code == 0", "then": "per_browser", "else": "failed"},
        {"id": "per_browser", "for_each": {"item": "browser", "in": "params.browsers", "max": 2},
         "body": "e2e", "after": "summary"},
        {"id": "e2e", "run": ["npx", "playwright", "test", "--project", "{browser}"],
         "retry": {"times": 2, "when": "e2e.exit_code != 0"}, "outputs": {"exit_code": "integer"}},
        {"id": "summary", "agent": "Resuma os testes.",
         "outputs": {"verdict": {"type": "choice", "from": ["approved", "changes", "blocked"]}}, "next": "done"},
        {"id": "failed", "fail": "npm ci failed"},
        {"id": "done", "end": True},
    ],
    "layout": {"clone": [0, 0], "install": [0, 120]},
}


def fluxo(**mudancas: object) -> dict:
    d = copy.deepcopy(BASE)
    d.update(mudancas)
    return d


def com_no(nid: str, **campos: object) -> dict:
    d = fluxo()
    for no in d["nodes"]:
        if no["id"] == nid:
            no.update(campos)
    return d


class TestValidacao(unittest.TestCase):
    def recusa(self, doc: object, codigo: str) -> None:
        with self.assertRaises(rf.ErroFluxo) as ctx:
            rf.validar(doc)
        self.assertEqual(ctx.exception.codigo, codigo, ctx.exception.detalhe)

    def test_fluxo_valido_e_pior_caso(self) -> None:
        fl = rf.validar(fluxo())
        # clone + install + if + (laço 1 + 2 × e2e com 2 retries) + summary + done
        self.assertEqual(fl.pior_caso, 1 + 1 + 1 + (1 + 2 * 3) + 1 + 1)
        self.assertNotIn("layout", fl.doc)

    def test_layout_fora_do_hash(self) -> None:
        a = rf.validar(fluxo()).sha256
        self.assertEqual(a, rf.validar(fluxo(layout={"clone": [9, 9]})).sha256)
        self.assertNotEqual(a, rf.validar(com_no("install_ok", **{"if": "install.exit_code != 0"})).sha256)
        reordenado = json.loads(json.dumps(fluxo()), object_pairs_hook=lambda kv: dict(reversed(kv)))
        self.assertEqual(a, rf.validar(reordenado).sha256)

    def test_chave_em_portugues(self) -> None:
        self.recusa(fluxo(passos=[]), "chave_desconhecida")
        d = fluxo()
        d["nodes"][1] = {"id": "install", "rodar": ["npm", "ci"], "next": "install_ok"}
        with self.assertRaises(rf.ErroFluxo) as ctx:
            rf.validar(d)
        self.assertIn("`run`", ctx.exception.detalhe)

    def test_ciclo_sem_laco(self) -> None:
        self.recusa(com_no("summary", next="install"), "ciclo_sem_laco")

    def test_laco_sem_max_e_aninhamento(self) -> None:
        d = fluxo()
        d["nodes"][3]["for_each"].pop("max")
        self.recusa(d, "numero_invalido")
        self.recusa(com_no("per_browser", for_each={"item": "browser", "in": "params.browsers", "max": 1}),
                    "for_each_invalido")  # a lista pode ter 2, o laço só 1

    def test_pior_caso_acima_do_limite(self) -> None:
        self.recusa(fluxo(limits={"max_steps": 10}), "pior_caso_alto")

    def test_condicao_fechada(self) -> None:
        for ruim in ("__import__('os')", "install.exit_code == 0; rm", "`ls`", "install.exit_code = 0"):
            self.recusa(com_no("install_ok", **{"if": ruim}), "condicao_invalida")
        self.recusa(com_no("install_ok", **{"if": "nada.exit_code == 0"}), "referencia_inexistente")
        self.recusa(com_no("install_ok", **{"if": "params.inexistente == 1"}), "referencia_inexistente")

    def test_avaliacao(self) -> None:
        arv = rf.analisar_condicao('(a.x >= 2 and not b.ok) or c.v in ["p", "q"]')
        self.assertTrue(rf.avaliar_condicao(arv, {"a.x": 3, "b.ok": False, "c.v": "z"}))
        self.assertTrue(rf.avaliar_condicao(arv, {"a.x": 0, "b.ok": True, "c.v": "q"}))
        self.assertFalse(rf.avaliar_condicao(arv, {"a.x": 0, "b.ok": True, "c.v": "z"}))
        with self.assertRaises(rf.ErroFluxo):
            rf.avaliar_condicao(rf.analisar_condicao('a.x < "1"'), {"a.x": 0})

    def test_caminho_e_alcance(self) -> None:
        d = fluxo()
        d["nodes"].append({"id": "solto", "end": True})
        self.recusa(d, "no_inalcancavel")
        self.recusa(com_no("summary", next="nao_existe"), "destino_inexistente")
        d = fluxo()
        d["nodes"][6] = {"id": "failed", "run": ["npm", "run", "report"]}  # alcançável, mas sem `next`
        self.recusa(d, "caminho_sem_fim")

    def test_molde_e_tipos(self) -> None:
        self.recusa(com_no("install", run=["npm", "{segredo}"]), "molde_inexistente")
        self.recusa(com_no("install", run="npm ci"), "args_invalidos")  # sem shell
        self.recusa(fluxo(version=1.5), "tipo_invalido")
        self.recusa(fluxo(environment={}), "ambiente_invalido")

    def test_steps_linear(self) -> None:
        fl = rf.validar({"name": "lint", "version": 1, "environment": {"image": "node:22"},
                         "steps": [{"run": ["npm", "ci"]}, {"run": ["npm", "run", "lint"]}]})
        self.assertEqual(fl.pior_caso, 3)

    def test_agent_step_exige_hash_e_timeout(self) -> None:
        passo = {"agent": "claude-jose", "workflow": "review-ux", "version": 3, "expect_sha256": "a" * 64,
                 "params": {"pr": "{pr}"}, "timeout": "30m"}
        ok = com_no("summary", agent_step=passo)
        ok["nodes"][5].pop("agent")
        rf.validar(ok)
        sem = copy.deepcopy(ok)
        sem["nodes"][5]["agent_step"].pop("timeout")
        self.recusa(sem, "agent_step_invalido")
        sem = copy.deepcopy(ok)
        sem["nodes"][5]["agent_step"]["expect_sha256"] = "curto"
        self.recusa(sem, "agent_step_invalido")

    def test_cadeia(self) -> None:
        rf.validar_cadeia(["a:x@1"], "b:y@1")
        with self.assertRaises(rf.ErroFluxo):
            rf.validar_cadeia(["a:x@1", "b:y@1"], "a:x@1")
        with self.assertRaises(rf.ErroFluxo):
            rf.validar_cadeia(["a:x@1", "b:y@1", "c:z@1"], "d:w@1")

    def test_parametros_do_pedido(self) -> None:
        fl = rf.validar(fluxo())
        ok = rf.validar_parametros(fl, {"repo": "joao/landing", "pr": 12, "browsers": ["firefox"]}, ["joao/landing"])
        self.assertEqual(ok["pr"], 12)
        for ruim in ({"repo": "joao/landing; rm -rf ~", "pr": 12, "browsers": ["firefox"]},
                     {"repo": "joao/landing", "pr": "12", "browsers": ["firefox"]},
                     {"repo": "joao/landing", "pr": 12, "browsers": ["../etc"]},
                     {"repo": "joao/landing", "pr": 12, "browsers": ["firefox"], "extra": 1}):
            with self.assertRaises(rf.ErroFluxo):
                rf.validar_parametros(fl, ruim, ["joao/landing"])


class SandboxFalso(rx.Sandbox):
    def __init__(self, codigos: dict[str, list[int]] | None = None):
        self.codigos, self.comandos, self.parado = codigos or {}, [], False

    def iniciar(self, imagem, rede, pasta):
        self.imagem = imagem

    def rodar(self, args, timeout_s):
        self.comandos.append(args)
        fila = self.codigos.get(args[-1], [0])
        return (fila.pop(0) if len(fila) > 1 else fila[0]), "ok"

    def fundo(self, args):
        self.comandos.append(["&", *args])

    def parar(self):
        self.parado = True


class AgenteFalso(rx.Agente):
    def __init__(self, saidas: dict):
        self.saidas = saidas

    def perguntar(self, prompt, saidas, contexto):
        return dict(self.saidas), "tudo certo"


def loja_temp() -> rx.Loja:
    return rx.Loja(Path(tempfile.mkdtemp(prefix="relay-exec-teste-")))


def sem_clone() -> dict:
    d = fluxo()
    d["nodes"] = d["nodes"][1:]
    d["params"].pop("repo")
    return d


class TestExecutor(unittest.TestCase):
    def setUp(self) -> None:
        self.loja = loja_temp()

    def aprovar(self, doc: dict, quem: list[str] | None = None) -> rf.Fluxo:
        fl = rf.validar(doc)
        sha = self.loja.guardar(rf.canonico(doc))
        self.assertEqual(sha, fl.sha256)
        self.loja.aprovar(fl, quem or ["ana"], "confirm")
        return fl

    def test_executa_com_laco_e_retry(self) -> None:
        fl = self.aprovar(sem_clone())
        sb = SandboxFalso({"chromium": [1, 0], "firefox": [0]})
        reg = rx.executar(self.loja, fl, {"pr": 3, "browsers": ["chromium", "firefox"]}, "ana", sandbox=sb,
                          agente=AgenteFalso({"verdict": "approved"}))
        self.assertEqual(reg["result"], "ok", reg["reason"])
        self.assertEqual(reg["outputs"]["verdict"], "approved")
        self.assertEqual([c[-1] for c in sb.comandos], ["ci", "chromium", "chromium", "firefox"])
        self.assertTrue(sb.parado)
        self.assertTrue(Path(reg["audit_file"]).exists())
        ramos = [t for t in reg["trail"] if t["type"] == "if"]
        self.assertEqual(ramos[0]["branch_taken"], "then")

    def test_ramo_de_falha(self) -> None:
        fl = self.aprovar(sem_clone())
        reg = rx.executar(self.loja, fl, {"pr": 3, "browsers": ["firefox"]}, "ana", sandbox=SandboxFalso({"ci": [1]}),
                          agente=AgenteFalso({"verdict": "approved"}))
        self.assertEqual((reg["result"], reg["reason"]), ("falhou", "npm ci failed"))

    def test_agente_fora_das_opcoes(self) -> None:
        fl = self.aprovar(sem_clone())
        reg = rx.executar(self.loja, fl, {"pr": 3, "browsers": ["firefox"]}, "ana", sandbox=SandboxFalso(),
                          agente=AgenteFalso({"verdict": "merge-agora"}))
        self.assertEqual(reg["result"], "falhou")
        self.assertIn("verdict", reg["reason"])

    def test_objeto_adulterado(self) -> None:
        fl = self.aprovar(sem_clone())
        caminho = self.loja._objeto(fl.sha256)
        caminho.chmod(0o644)
        caminho.write_bytes(caminho.read_bytes().replace(b"npm", b"rm "))
        with self.assertRaises(rx.Recusa):
            self.loja.abrir(fl.sha256)
        self.assertFalse(caminho.exists())

    def test_aprovados_editado_fora(self) -> None:
        self.aprovar(sem_clone())
        caminho = self.loja.raiz / "approved.json"
        caminho.write_text(caminho.read_text().replace('"ana"', '"mallory"'))
        with self.assertRaises(rx.Recusa):
            self.loja.aprovados()

    def test_checar_pedido(self) -> None:
        fl = self.aprovar(sem_clone(), ["ana"])
        p = {"id": 1, "de": "ana", "nome": fl.nome, "versao": fl.versao, "params": {"pr": 1, "browsers": ["firefox"]},
             "chain": [], "expect_sha256": fl.sha256}
        rx.checar_pedido(self.loja, p)
        for mudanca, motivo in (({"de": "mallory"}, "quem pode"), ({"versao": 5}, "versão"),
                                ({"expect_sha256": "b" * 64}, "hash"), ({"params": {"pr": 0, "browsers": []}}, "pr"),
                                ({"chain": [f"{rx.NOME}:{fl.nome}@{fl.versao}"]}, "ciclo")):
            with self.assertRaises(rx.Recusa, msg=motivo):
                rx.checar_pedido(self.loja, {**p, **mudanca})


class TestCatalogoEPedidos(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.t_ana, cls.t_bot = token("ana-fx", "humano"), token("bot-fx", "ia")

    def test_publicar_e_baixar(self) -> None:
        status, r = pedir("POST", "/fluxos", {"sala": "fx1", "fluxo": fluxo()}, token=self.t_ana)
        self.assertEqual(status, 201, r)
        self.assertEqual(r["sha256"], rf.validar(fluxo()).sha256)
        status, _ = pedir("POST", "/fluxos", {"sala": "fx1", "fluxo": fluxo()}, token=self.t_ana)
        self.assertEqual(status, 200)  # idempotente
        status, r = pedir("POST", "/fluxos", {"sala": "fx1", "fluxo": com_no("install", run=["npm", "i"])},
                          token=self.t_ana)
        self.assertEqual((status, r["codigo"]), (409, "versao_publicada"))
        status, r = pedir("GET", "/fluxos/test-pr?sala=fx1")
        self.assertEqual(status, 200)
        import hashlib
        self.assertEqual(hashlib.sha256(r["conteudo"].encode()).hexdigest(), r["sha256"])
        self.assertEqual(r["layout"], BASE["layout"])
        _, lista = pedir("GET", "/fluxos?sala=fx1")
        self.assertEqual([f["nome"] for f in lista], ["test-pr"])

    def test_publicar_recusa_invalido(self) -> None:
        status, r = pedir("POST", "/fluxos", {"sala": "fx2", "fluxo": com_no("summary", next="install")})
        self.assertEqual((status, r["codigo"]), (422, "ciclo_sem_laco"))

    def test_ciclo_de_vida_do_pedido(self) -> None:
        pedir("POST", "/fluxos", {"sala": "fx3", "fluxo": fluxo()}, token=self.t_ana)
        corpo = {"sala": "fx3", "agente": "bot-fx", "nome": "test-pr", "versao": 4, "params": {"pr": 1}}
        status, p = pedir("POST", "/fluxos/pedidos", corpo, token=self.t_ana)
        self.assertEqual((status, p["estado"], p["de"]), (201, "pendente", "ana-fx"))
        status, r = pedir("POST", f"/fluxos/pedidos/{p['id']}/estado", {"estado": "aceito"}, token=self.t_ana)
        self.assertEqual(status, 403)  # só o agente pedido aceita
        status, r = pedir("POST", f"/fluxos/pedidos/{p['id']}/estado", {"estado": "concluido"}, token=self.t_bot)
        self.assertEqual((status, r["codigo"]), (409, "pedido_decidido"))
        pedir("POST", f"/fluxos/pedidos/{p['id']}/estado", {"estado": "aceito"}, token=self.t_bot)
        status, r = pedir("POST", f"/fluxos/pedidos/{p['id']}/estado",
                          {"estado": "concluido", "resultado": {"outputs": {"verdict": "approved"}}}, token=self.t_bot)
        self.assertEqual((status, r["estado"], r["resultado"]["outputs"]["verdict"]), (200, "concluido", "approved"))
        _, minhas = pedir("GET", "/fluxos/pedidos?agente=bot-fx", token=self.t_bot)
        self.assertIn(p["id"], [x["id"] for x in minhas])
        estranho = token("eve-fx", "ia")
        status, _ = pedir("GET", f"/fluxos/pedidos/{p['id']}", token=estranho)
        self.assertEqual(status, 404)

    def test_pedido_recusado_na_entrada(self) -> None:
        pedir("POST", "/fluxos", {"sala": "fx4", "fluxo": fluxo()}, token=self.t_ana)
        base = {"sala": "fx4", "agente": "bot-fx", "nome": "test-pr", "versao": 4}
        casos = [({"versao": 9}, 404, "fluxo_inexistente"), ({"expect_sha256": "c" * 64}, 409, "hash_diferente"),
                 ({"chain": ["a:x@1", "b:y@1", "c:z@1"]}, 422, "cadeia_longa"),
                 ({"chain": ["bot-fx:test-pr@4"]}, 422, "cadeia_ciclo")]
        for extra, status_esperado, codigo in casos:
            status, r = pedir("POST", "/fluxos/pedidos", {**base, **extra}, token=self.t_ana)
            self.assertEqual((status, r["codigo"]), (status_esperado, codigo), extra)


class TestEntreIAs(unittest.TestCase):
    """agent_step de ponta a ponta: o executor do 'bot' atende o pedido do executor da 'ana' pelo relay."""

    def test_agent_step(self) -> None:
        t_ana, t_bot = token("ana-ia", "humano"), token("bot-ia", "ia")
        remoto_doc = {"name": "review-ux", "version": 3, "environment": {"image": "node:22"},
                      "params": {"pr": {"type": "integer", "min": 1}},
                      "nodes": [{"id": "look", "agent": "Avalie o PR {pr}.",
                                 "outputs": {"verdict": {"type": "choice", "from": ["approved", "changes"]}},
                                 "next": "done"}, {"id": "done", "end": True}]}
        remoto = rf.validar(remoto_doc)
        pedir("POST", "/fluxos", {"sala": "fx5", "fluxo": remoto_doc}, token=t_bot)
        loja_bot = loja_temp()
        loja_bot.guardar(rf.canonico(remoto_doc))
        loja_bot.aprovar(remoto, ["ana-ia"], "audit")

        local_doc = {"name": "ship", "version": 1, "environment": {"image": "node:22"},
                     "params": {"pr": {"type": "integer", "min": 1}},
                     "nodes": [{"id": "ux", "agent_step": {"agent": "bot-ia", "workflow": "review-ux", "version": 3,
                                                           "expect_sha256": remoto.sha256, "params": {"pr": "{pr}"},
                                                           "timeout": "60s"},
                                "outputs": {"verdict": {"type": "choice", "from": ["approved", "changes"]}},
                                "next": "decide"},
                               {"id": "decide", "switch": "ux.verdict", "cases": {"approved": "done"},
                                "default": "nope"},
                               {"id": "nope", "fail": "UX pediu ajustes"}, {"id": "done", "end": True}]}
        local = rf.validar(local_doc)
        loja_ana = loja_temp()
        loja_ana.guardar(rf.canonico(local_doc))
        loja_ana.aprovar(local, ["ana-ia"], "audit")

        import threading
        rx.URL = URL

        class ParesComToken(rx.Pares):
            def pedir(self, *a, **kw):
                rx._LOCAL.token = t_ana
                return super().pedir(*a, **kw)

        def lado_bot() -> None:
            import time
            for _ in range(100):
                rx._LOCAL.token = t_bot
                pend = rx.relay("GET", "/fluxos/pedidos?agente=bot-ia&estado=pendente")
                if pend:
                    nome_antigo, rx.NOME = rx.NOME, "bot-ia"
                    try:
                        rx.atender(loja_bot, pend[0], sandbox=SandboxFalso(),
                                   agente=AgenteFalso({"verdict": "approved"}))
                    finally:
                        rx.NOME = nome_antigo
                    return
                time.sleep(0.2)

        bot = threading.Thread(target=lado_bot)
        bot.start()
        reg = rx.executar(loja_ana, local, {"pr": 7}, "ana-ia", sandbox=SandboxFalso(), pares=ParesComToken(),
                          sala="fx5")
        bot.join(30)
        self.assertEqual(reg["result"], "ok", reg["reason"])
        self.assertEqual(reg["outputs"], {"verdict": "approved"})
        _, pedidos = pedir("GET", "/fluxos/pedidos?agente=bot-ia")
        self.assertEqual(pedidos[-1]["estado"], "concluido")
        self.assertEqual(pedidos[-1]["chain"], [f"{rx.NOME}:ship@1"])


if __name__ == "__main__":
    unittest.main()
