"""Anexos vistos pela memória: GET /arquivos/<id>/info, GET /arquivos?sala= e o teto maior de GET /fatos.

Usa o mesmo servidor de teste do test_fatos (banco temporário).
"""
import json
import unittest
import urllib.error
import urllib.request

from test_fatos import URL, pedir, rs, token


def subir(nome: str, conteudo: bytes, tipo: str = "text/markdown", tk: str = "admin-de-teste") -> dict:
    rs.ENVIOS.estado.clear()
    req = urllib.request.Request(URL + "/arquivos?de=lume", method="POST", data=conteudo,
                                 headers={"Authorization": f"Bearer {tk}", "Content-Type": tipo, "X-Nome": nome})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def anexar(sala: str, aid: str, para: str | None = None, de: str = "lume") -> int:
    rs.ENVIOS.estado.clear()
    corpo = {"sala": sala, "de": de, "texto": "segue o arquivo", "anexos": [aid]}
    if para:
        corpo["para"] = para
    status, r = pedir("POST", "/mensagens", corpo)
    assert status == 201, r
    return r["id"]


class TestInfoArquivo(unittest.TestCase):
    def test_info_traz_metadados_sem_conteudo(self):
        a = subir("PLANO-FLUXOS.md", b"# Plano\n")
        mid = anexar("arq-info", a["id"])
        status, info = pedir("GET", f"/arquivos/{a['id']}/info")
        self.assertEqual(status, 200, info)
        self.assertEqual(info["nome"], "PLANO-FLUXOS.md")
        self.assertEqual(info["tipo"], "text/markdown")
        self.assertEqual(info["tamanho"], 8)
        self.assertEqual(info["msg_id"], mid)
        self.assertEqual(info["sala"], "arq-info")
        self.assertEqual(info["url"], f"/arquivos/{a['id']}")

    def test_info_inexistente_404(self):
        status, r = pedir("GET", "/arquivos/naoexiste1234567890/info")
        self.assertEqual(status, 404)
        self.assertEqual(r["codigo"], "arquivo_inexistente")

    def test_anexo_privado_some_para_terceiros(self):
        tk = token("arq-intruso", "ia")
        a = subir("segredo.txt", b"so pra bia", "text/plain")
        anexar("arq-priv", a["id"], para="bia")
        status, _ = pedir("GET", f"/arquivos/{a['id']}/info", token=tk)
        self.assertEqual(status, 404)
        # O download segue a mesma regra (a checagem é compartilhada).
        req = urllib.request.Request(URL + f"/arquivos/{a['id']}", headers={"Authorization": f"Bearer {tk}"})
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(e.exception.code, 404)
        # Admin continua vendo.
        status, _ = pedir("GET", f"/arquivos/{a['id']}/info")
        self.assertEqual(status, 200)


class TestArquivosDaSala(unittest.TestCase):
    def test_lista_publicos_da_sala_e_filtra_por_nome(self):
        a = subir("relay_fluxos.py", b"print(1)\n", "text/x-python")
        b = subir("print.png", b"\x89PNG", "image/png")
        c = subir("privado.md", b"x")
        outra = subir("de-outra-sala.md", b"x")
        anexar("arq-lista", a["id"])
        anexar("arq-lista", b["id"])
        anexar("arq-lista", c["id"], para="bia")
        anexar("arq-outra", outra["id"])

        status, lista = pedir("GET", "/arquivos?sala=arq-lista")
        self.assertEqual(status, 200, lista)
        self.assertEqual([x["nome"] for x in lista], ["print.png", "relay_fluxos.py"])  # mais novo primeiro, sem o privado

        status, achados = pedir("GET", "/arquivos?sala=arq-lista&q=FLUXOS")
        self.assertEqual([x["id"] for x in achados], [a["id"]])

    def test_anexo_solto_nao_aparece(self):
        subir("solto.md", b"sem mensagem")
        status, lista = pedir("GET", "/arquivos?sala=arq-solto")
        self.assertEqual(status, 200)
        self.assertEqual(lista, [])


class TestLimiteFatos(unittest.TestCase):
    def test_aceita_mais_de_50(self):
        rs.ENVIOS.estado.clear()
        status, origem = pedir("POST", "/mensagens", {"sala": "arq-fatos", "de": "lume", "texto": "origem"})
        self.assertEqual(status, 201)
        for i in range(60):
            rs.ENVIOS.estado.clear()
            rs.FATOS.estado.clear()
            s, r = pedir("POST", "/fatos", {"sala": "arq-fatos", "de": "lume", "sujeito": f"item {i}", "predicado": "é",
                                            "objeto": "teste", "origem_tipo": "msg", "origem_id": str(origem["id"])})
            self.assertEqual(s, 201, r)
        status, fatos = pedir("GET", "/fatos?sala=arq-fatos&limite=300")
        self.assertEqual(status, 200)
        self.assertEqual(len(fatos), 60)
        status, fatos = pedir("GET", "/fatos?sala=arq-fatos&limite=100000")
        self.assertEqual(len(fatos), 60)  # o teto (500) só corta, não dá erro


if __name__ == "__main__":
    unittest.main()
