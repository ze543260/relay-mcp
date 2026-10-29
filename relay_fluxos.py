"""Workflows do relay: esquema fechado (em inglês), condições sem `eval`, validação estática e hash canônico.

Compartilhado pelo servidor (valida o que é publicado) e pelo executor (valida de novo antes de aprovar e de rodar).
Só stdlib. Plano: docs/PLANO-FLUXOS.md (seções 3, 11 e 12).

O arquivo de workflow é JSON (ou YAML convertido para JSON fora daqui). A forma canônica é o JSON com chaves
ordenadas e sem espaços, sem `layout`; como o esquema só aceita inteiros, textos e booleanos, e identificadores
ASCII, isso coincide com o JCS (RFC 8785). O SHA-256 dessa forma é a identidade do fluxo aprovado.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field

TAM_MAX = 64 * 1024
NOS_MAX = 100
PASSOS_TETO = 200          # teto absoluto do pior caso, mesmo que `limits.max_steps` peça mais
FOR_EACH_MAX, REPEAT_MAX, RETRY_MAX = 20, 10, 3
ANINHAMENTO_MAX = 2
SALTOS_MAX = 3             # fluxos entre IAs: profundidade máxima da cadeia de pedidos

ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
VALOR_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,99}$")   # valores de choice/list e chaves de `cases`
AGENTE_RE = re.compile(r"^[\w.-]{1,32}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
DURACAO_RE = re.compile(r"^([1-9][0-9]{0,4})(s|m|h)$")
MOLDE_RE = re.compile(r"\{([a-z][a-z0-9_]*)\}")
REPOS_APROVADOS = "approved_repos"   # lista local do dono; o valor vem de ~/.relay/workflows/repos.json

TIPOS_NO = ("clone", "run", "serve", "agent", "agent_step", "if", "switch", "for_each", "repeat_until",
            "approval", "fail", "end")
TERMINAIS = ("fail", "end")
LACOS = ("for_each", "repeat_until")
TIPOS_SAIDA = ("integer", "boolean", "choice")
CHAVES_TOPO = {"name", "version", "description", "params", "environment", "limits", "nodes", "steps", "layout"}
CHAVES_COMUNS = {"id", "label", "next", "outputs", "retry", "timeout", "on_timeout"}
CHAVES_NO = {
    "clone": {"ref"}, "run": set(), "serve": set(), "agent": set(), "agent_step": set(),
    "if": {"then", "else"}, "switch": {"cases", "default"}, "for_each": {"body", "after"},
    "repeat_until": {"body", "after"}, "approval": set(), "fail": set(), "end": set(),
}
# Chaves em português de versões antigas do plano: erro com a sugestão certa (seção 9).
EM_PORTUGUES = {"nome": "name", "versao": "version", "descricao": "description", "parametros": "params",
                "ambiente": "environment", "limites": "limits", "nos": "nodes", "passos": "steps", "rodar": "run",
                "clonar": "clone", "servir": "serve", "agente": "agent", "se": "if", "entao": "then",
                "senao": "else", "escolher": "switch", "para_cada": "for_each", "repetir_ate": "repeat_until",
                "aprovar": "approval", "falhar": "fail", "terminar": "end", "proximo": "next", "saidas": "outputs",
                "tentar_de_novo": "retry", "corpo": "body", "depois": "after"}


class ErroFluxo(ValueError):
    """Fluxo recusado. `codigo` é estável (vai para a API e para os testes)."""

    def __init__(self, codigo: str, detalhe: str):
        super().__init__(detalhe)
        self.codigo, self.detalhe = codigo, detalhe


def _erro(codigo: str, detalhe: str) -> ErroFluxo:
    return ErroFluxo(codigo, detalhe)


# --- Condições: gramática fechada ------------------------------------------
#   expr   := or
#   or     := and ("or" and)*
#   and    := not ("and" not)*
#   not    := "not" not | cmp
#   cmp    := valor (("=="|"!="|"<"|"<="|">"|">="|"in") valor)?
#   valor  := número | "texto" | true | false | ref | "(" expr ")" | "[" valor ("," valor)* "]"
#   ref    := ident ("." ident)?

_TOKEN_RE = re.compile(r"\s*(?:(?P<num>-?\d{1,9})|(?P<txt>\"[^\"\\]{0,100}\")|(?P<op>==|!=|<=|>=|<|>|\(|\)|\[|\]|,)"
                       r"|(?P<id>[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?))")
_PALAVRAS = {"and", "or", "not", "in", "true", "false"}
COND_MAX = 300


def _tokens(texto: str) -> list[tuple[str, object]]:
    if not isinstance(texto, str) or not texto.strip() or len(texto) > COND_MAX:
        raise _erro("condicao_invalida", f"Condição deve ser texto de 1–{COND_MAX} caracteres.")
    pos, saida = 0, []
    while pos < len(texto):
        if texto[pos:].strip() == "":
            break
        m = _TOKEN_RE.match(texto, pos)
        if not m or m.end() == pos:
            raise _erro("condicao_invalida", f"Caractere não permitido na condição perto de {texto[pos:pos + 10]!r}.")
        pos = m.end()
        if m.group("num") is not None:
            saida.append(("num", int(m.group("num"))))
        elif m.group("txt") is not None:
            saida.append(("txt", m.group("txt")[1:-1]))
        elif m.group("op") is not None:
            saida.append(("op", m.group("op")))
        else:
            ident = m.group("id")
            if ident in ("true", "false"):
                saida.append(("bool", ident == "true"))
            elif ident in _PALAVRAS:
                saida.append(("op", ident))
            else:
                saida.append(("ref", ident))
    return saida


class _Parser:
    def __init__(self, texto: str):
        self.t = _tokens(texto)
        self.i = 0

    def _ver(self) -> tuple[str, object] | None:
        return self.t[self.i] if self.i < len(self.t) else None

    def _op(self, *ops: str) -> str | None:
        tok = self._ver()
        if tok and tok[0] == "op" and tok[1] in ops:
            self.i += 1
            return str(tok[1])
        return None

    def tudo(self) -> tuple:
        no = self._ou()
        if self._ver() is not None:
            raise _erro("condicao_invalida", "Sobrou texto no fim da condição.")
        return no

    def _ou(self) -> tuple:
        no = self._e()
        while self._op("or"):
            no = ("or", no, self._e())
        return no

    def _e(self) -> tuple:
        no = self._nao()
        while self._op("and"):
            no = ("and", no, self._nao())
        return no

    def _nao(self) -> tuple:
        if self._op("not"):
            return ("not", self._nao())
        return self._cmp()

    def _cmp(self) -> tuple:
        esq = self._valor()
        op = self._op("==", "!=", "<", "<=", ">", ">=", "in")
        return (op, esq, self._valor()) if op else esq

    def _valor(self) -> tuple:
        tok = self._ver()
        if tok is None:
            raise _erro("condicao_invalida", "Condição terminou no meio.")
        if self._op("("):
            no = self._ou()
            if not self._op(")"):
                raise _erro("condicao_invalida", "Falta fechar parêntese.")
            return no
        if self._op("["):
            itens = [self._valor()]
            while self._op(","):
                itens.append(self._valor())
            if not self._op("]"):
                raise _erro("condicao_invalida", "Falta fechar colchete.")
            if any(i[0] not in ("lit",) for i in itens):
                raise _erro("condicao_invalida", "Lista na condição só aceita literais.")
            return ("lit", [i[1] for i in itens])
        self.i += 1
        if tok[0] in ("num", "txt", "bool"):
            return ("lit", tok[1])
        if tok[0] == "ref":
            return ("ref", tok[1])
        raise _erro("condicao_invalida", f"Esperado um valor, veio {tok[1]!r}.")


def analisar_condicao(texto: str) -> tuple:
    """Texto -> árvore. Recusa tudo fora da gramática (nunca passa por eval)."""
    return _Parser(texto).tudo()


def refs_da_condicao(arvore: tuple) -> set[str]:
    if arvore[0] == "ref":
        return {str(arvore[1])}
    if arvore[0] == "lit":
        return set()
    return set().union(*(refs_da_condicao(f) for f in arvore[1:]))


def avaliar_condicao(arvore: tuple, contexto: dict[str, object]) -> object:
    """`contexto`: ref -> valor (ex.: {"install.exit_code": 0, "params.pr": 12, "browser": "firefox"})."""
    tipo = arvore[0]
    if tipo == "lit":
        return arvore[1]
    if tipo == "ref":
        if arvore[1] not in contexto:
            raise _erro("referencia_sem_valor", f"{arvore[1]} ainda não tem valor neste ponto do fluxo.")
        return contexto[arvore[1]]
    if tipo == "not":
        return not _booleano(avaliar_condicao(arvore[1], contexto))
    if tipo == "and":
        return _booleano(avaliar_condicao(arvore[1], contexto)) and _booleano(avaliar_condicao(arvore[2], contexto))
    if tipo == "or":
        return _booleano(avaliar_condicao(arvore[1], contexto)) or _booleano(avaliar_condicao(arvore[2], contexto))
    a, b = avaliar_condicao(arvore[1], contexto), avaliar_condicao(arvore[2], contexto)
    if tipo == "in":
        if not isinstance(b, list):
            raise _erro("condicao_tipo", "`in` precisa de uma lista à direita.")
        return a in b
    if tipo in ("==", "!="):
        return (a == b) if tipo == "==" else (a != b)
    if not (isinstance(a, int) and isinstance(b, int)) or isinstance(a, bool) or isinstance(b, bool):
        raise _erro("condicao_tipo", f"`{tipo}` só compara números.")
    return {"<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b}[tipo]


def _booleano(v: object) -> bool:
    if not isinstance(v, bool):
        raise _erro("condicao_tipo", "and/or/not só combinam verdadeiro/falso.")
    return v


# --- Validação --------------------------------------------------------------

@dataclass
class Fluxo:
    """Fluxo validado. `nos` já em forma de grafo (o formato linear `steps` vira nós aqui)."""
    doc: dict                       # forma canônica (sem layout)
    sha256: str
    nos: dict[str, dict]
    inicio: str
    regiao: dict[str, str | None]   # nó -> laço dono (None = nível de cima)
    pior_caso: int
    condicoes: dict[str, tuple] = field(default_factory=dict)   # nó -> árvore (if, repeat_until, retry.when)

    @property
    def nome(self) -> str:
        return str(self.doc["name"])

    @property
    def versao(self) -> int:
        return int(self.doc["version"])


def canonico(doc: dict) -> bytes:
    """JSON canônico do fluxo sem `layout` (layout é só visual e não entra no hash)."""
    sem_layout = {k: v for k, v in doc.items() if k != "layout"}
    return json.dumps(sem_layout, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def sha256_de(doc: dict) -> str:
    return hashlib.sha256(canonico(doc)).hexdigest()


def duracao_s(texto: object, campo: str) -> int:
    m = DURACAO_RE.match(texto) if isinstance(texto, str) else None
    if not m:
        raise _erro("duracao_invalida", f"{campo}: use 30s, 15m ou 2h.")
    return int(m.group(1)) * {"s": 1, "m": 60, "h": 3600}[m.group(2)]


def _checar_tipos_json(v: object, caminho: str) -> None:
    """Só dict/list/str/int/bool: sem float (o hash canônico depende disso) e sem null."""
    if isinstance(v, dict):
        for k, x in v.items():
            if not isinstance(k, str):
                raise _erro("tipo_invalido", f"{caminho}: chave não textual.")
            _checar_tipos_json(x, f"{caminho}.{k}")
    elif isinstance(v, list):
        for i, x in enumerate(v):
            _checar_tipos_json(x, f"{caminho}[{i}]")
    elif not isinstance(v, (str, int, bool)):
        raise _erro("tipo_invalido", f"{caminho}: só texto, inteiro, booleano, lista e objeto (sem decimal nem null).")


def _chaves(obj: object, permitidas: set[str], onde: str) -> dict:
    if not isinstance(obj, dict):
        raise _erro("formato_invalido", f"{onde}: esperado um objeto.")
    for k in obj:
        if k not in permitidas:
            dica = f" Use `{EM_PORTUGUES[k]}` (o arquivo é em inglês)." if k in EM_PORTUGUES else ""
            raise _erro("chave_desconhecida", f"{onde}: chave `{k}` não existe no esquema.{dica}")
    return obj


def _ident(v: object, onde: str) -> str:
    if not isinstance(v, str) or not ID_RE.match(v):
        raise _erro("id_invalido", f"{onde}: identificador deve ser minúsculo, começar com letra (a-z, 0-9, _; até 40).")
    return v


def _int(v: object, onde: str, minimo: int, maximo: int) -> int:
    if not isinstance(v, int) or isinstance(v, bool) or not minimo <= v <= maximo:
        raise _erro("numero_invalido", f"{onde}: inteiro de {minimo} a {maximo}.")
    return v


def _valores(v: object, onde: str, maximo: int = 50) -> list[str]:
    if not isinstance(v, list) or not 1 <= len(v) <= maximo or len(set(map(str, v))) != len(v):
        raise _erro("opcoes_invalidas", f"{onde}: lista de 1–{maximo} opções sem repetir.")
    for x in v:
        if not isinstance(x, str) or not VALOR_RE.match(x):
            raise _erro("opcoes_invalidas", f"{onde}: opção {x!r} inválida (letras, números e . _ / @ : + -).")
    return v


def _validar_params(params: object) -> dict[str, dict]:
    if params is None:
        return {}
    if not isinstance(params, dict) or len(params) > 20:
        raise _erro("params_invalidos", "params: objeto com até 20 parâmetros.")
    for nome, p in params.items():
        _ident(nome, f"params.{nome}")
        _chaves(p, {"type", "from", "min", "max", "label"}, f"params.{nome}")
        tipo = p.get("type")
        if tipo == "choice":
            if p.get("from") != REPOS_APROVADOS:
                _valores(p.get("from"), f"params.{nome}.from")
        elif tipo == "list":
            _valores(p.get("from"), f"params.{nome}.from")
            _int(p.get("max"), f"params.{nome}.max", 1, 20)
        elif tipo == "integer":
            mn, mx = p.get("min", 0), p.get("max", 10**9)
            _int(mn, f"params.{nome}.min", -10**9, 10**9)
            _int(mx, f"params.{nome}.max", -10**9, 10**9)
            if mn > mx:
                raise _erro("params_invalidos", f"params.{nome}: min maior que max.")
        elif tipo == "boolean":
            pass
        else:
            raise _erro("params_invalidos", f"params.{nome}.type: choice, list, integer ou boolean (sem texto livre).")
    return params


def _validar_saidas(no: dict, tipo: str, onde: str) -> dict[str, dict]:
    saidas = no.get("outputs")
    if saidas is None:
        return {}
    if not isinstance(saidas, dict) or len(saidas) > 10:
        raise _erro("saidas_invalidas", f"{onde}.outputs: objeto com até 10 saídas.")
    norm: dict[str, dict] = {}
    for nome, decl in saidas.items():
        _ident(nome, f"{onde}.outputs.{nome}")
        if tipo in ("run",):
            if nome != "exit_code" or decl not in ("integer", {"type": "integer"}):
                raise _erro("saidas_invalidas", f"{onde}: `run` só declara `exit_code: integer`.")
            norm[nome] = {"type": "integer"}
            continue
        if tipo not in ("agent", "agent_step"):
            raise _erro("saidas_invalidas", f"{onde}: nó `{tipo}` não declara saídas.")
        d = {"type": decl} if isinstance(decl, str) else decl
        _chaves(d, {"type", "from"}, f"{onde}.outputs.{nome}")
        if d.get("type") not in TIPOS_SAIDA:
            raise _erro("saidas_invalidas", f"{onde}.outputs.{nome}: tipo integer, boolean ou choice (sem texto livre).")
        if d["type"] == "choice":
            _valores(d.get("from"), f"{onde}.outputs.{nome}.from")
        elif "from" in d:
            raise _erro("saidas_invalidas", f"{onde}.outputs.{nome}: `from` só vale para choice.")
        norm[nome] = d
    return norm


def _moldes(texto: object, onde: str) -> set[str]:
    if not isinstance(texto, str) or not 1 <= len(texto) <= 4000:
        raise _erro("texto_invalido", f"{onde}: texto de 1–4000 caracteres.")
    return set(MOLDE_RE.findall(texto))


def _args(lista: object, onde: str) -> set[str]:
    if not isinstance(lista, list) or not 1 <= len(lista) <= 64:
        raise _erro("args_invalidos", f"{onde}: lista de 1–64 argumentos (sem shell).")
    usados: set[str] = set()
    for a in lista:
        if not isinstance(a, str) or not 1 <= len(a) <= 500 or "\x00" in a:
            raise _erro("args_invalidos", f"{onde}: argumento inválido {a!r}.")
        usados |= set(MOLDE_RE.findall(a))
    return usados


def _de_steps(steps: object) -> list[dict]:
    """Formato linear da seção 3 (`steps`) -> nós encadeados terminando em `end`."""
    if not isinstance(steps, list) or not 1 <= len(steps) <= NOS_MAX - 1:
        raise _erro("formato_invalido", f"steps: lista de 1–{NOS_MAX - 1} passos.")
    nos = []
    for i, s in enumerate(steps):
        if not isinstance(s, dict):
            raise _erro("formato_invalido", f"steps[{i}]: esperado um objeto.")
        if "id" in s or "next" in s:
            raise _erro("formato_invalido", f"steps[{i}]: em `steps` não há id/next; use `nodes` para desviar.")
        nos.append({**s, "id": f"step_{i + 1}", "next": f"step_{i + 2}" if i + 1 < len(steps) else "end"})
    nos.append({"id": "end", "end": True})
    return nos


def validar(doc: object) -> Fluxo:
    """Valida o fluxo inteiro (seções 3, 11.1–11.3 e 12). Levanta ErroFluxo com o primeiro problema."""
    if not isinstance(doc, dict):
        raise _erro("formato_invalido", "O fluxo deve ser um objeto JSON.")
    _checar_tipos_json(doc, "fluxo")
    if len(json.dumps(doc, ensure_ascii=False).encode()) > TAM_MAX:
        raise _erro("fluxo_grande", f"Fluxo grande demais (máx. {TAM_MAX // 1024} KB).")
    _chaves(doc, CHAVES_TOPO, "fluxo")
    nome = doc.get("name")
    if not isinstance(nome, str) or not re.match(r"^[a-z][a-z0-9-]{0,47}$", nome):
        raise _erro("nome_invalido", "name: minúsculas, números e hífen (até 48), começando com letra.")
    _int(doc.get("version"), "version", 1, 10**6)
    if "description" in doc:
        _moldes(doc["description"], "description")
    params = _validar_params(doc.get("params"))
    amb = _chaves(doc.get("environment"), {"image", "network", "timeout"}, "environment")
    if not isinstance(amb.get("image"), str) or not re.match(r"^[\w.:/@-]{1,200}$", amb["image"]):
        raise _erro("ambiente_invalido", "environment.image é obrigatório (todo fluxo roda num container).")
    rede = amb.get("network", [])
    if not isinstance(rede, list) or len(rede) > 20 or not all(
            isinstance(h, str) and re.match(r"^[a-z0-9.-]{1,253}$", h) for h in rede):
        raise _erro("ambiente_invalido", "environment.network: lista de até 20 hosts.")
    if "timeout" in amb:
        duracao_s(amb["timeout"], "environment.timeout")
    limites = _chaves(doc.get("limits", {}), {"max_steps", "timeout"}, "limits")
    max_passos = _int(limites.get("max_steps", PASSOS_TETO), "limits.max_steps", 1, PASSOS_TETO)
    if "timeout" in limites:
        duracao_s(limites["timeout"], "limits.timeout")
    if "nodes" in doc and "steps" in doc:
        raise _erro("formato_invalido", "Use `nodes` ou `steps`, não os dois.")
    if "layout" in doc and not isinstance(doc["layout"], dict):
        raise _erro("formato_invalido", "layout: objeto id -> [x, y].")
    lista = doc["nodes"] if "nodes" in doc else _de_steps(doc.get("steps"))
    if not isinstance(lista, list) or not 1 <= len(lista) <= NOS_MAX:
        raise _erro("formato_invalido", f"nodes: lista de 1–{NOS_MAX} nós.")

    nos: dict[str, dict] = {}
    for i, no in enumerate(lista):
        if not isinstance(no, dict):
            raise _erro("formato_invalido", f"nodes[{i}]: esperado um objeto.")
        nid = _ident(no.get("id"), f"nodes[{i}].id")
        if nid in nos:
            raise _erro("id_repetido", f"Nó `{nid}` aparece duas vezes.")
        if nid == "params":
            raise _erro("id_invalido", "`params` é reservado.")
        tipos = [t for t in TIPOS_NO if t in no]
        if len(tipos) != 1:
            pt = [k for k in no if k in EM_PORTUGUES]
            dica = f" Chave em português: `{pt[0]}` → `{EM_PORTUGUES[pt[0]]}`." if pt else ""
            raise _erro("tipo_no_invalido", f"Nó `{nid}`: precisa de exatamente um tipo ({', '.join(TIPOS_NO)}).{dica}")
        tipo = tipos[0]
        _chaves(no, {tipo} | CHAVES_COMUNS | CHAVES_NO[tipo], f"nó {nid}")
        nos[nid] = {**no, "_tipo": tipo}

    condicoes: dict[str, tuple] = {}
    saidas_de: dict[str, dict[str, dict]] = {}
    for nid, no in nos.items():
        tipo, onde = no["_tipo"], f"nó {nid}"
        saidas_de[nid] = _validar_saidas(no, tipo, onde)
        if "timeout" in no:
            duracao_s(no["timeout"], f"{onde}.timeout")
        if "retry" in no:
            if tipo not in ("run", "agent", "agent_step"):
                raise _erro("retry_invalido", f"{onde}: retry só em run, agent e agent_step.")
            r = _chaves(no["retry"], {"times", "when"}, f"{onde}.retry")
            _int(r.get("times"), f"{onde}.retry.times", 1, RETRY_MAX)
            if "when" in r:
                condicoes[f"{nid}#retry"] = analisar_condicao(r["when"])
        if "on_timeout" in no and tipo != "agent_step":
            raise _erro("formato_invalido", f"{onde}: on_timeout só existe em agent_step.")
        if tipo == "clone":
            _moldes(no["clone"], f"{onde}.clone")
            if "ref" in no:
                _moldes(no["ref"], f"{onde}.ref")
        elif tipo == "run":
            _args(no["run"], f"{onde}.run")
        elif tipo == "serve":
            s = _chaves(no["serve"], {"command", "port"}, f"{onde}.serve")
            _args(s.get("command"), f"{onde}.serve.command")
            _int(s.get("port"), f"{onde}.serve.port", 1024, 65535)
        elif tipo == "agent":
            _moldes(no["agent"], f"{onde}.agent")
        elif tipo == "agent_step":
            a = _chaves(no["agent_step"], {"agent", "workflow", "version", "expect_sha256", "params", "timeout"},
                        f"{onde}.agent_step")
            if not isinstance(a.get("agent"), str) or not AGENTE_RE.match(a["agent"]):
                raise _erro("agent_step_invalido", f"{onde}.agent_step.agent: nome de agente da sala.")
            if not isinstance(a.get("workflow"), str) or not re.match(r"^[a-z][a-z0-9-]{0,47}$", a["workflow"]):
                raise _erro("agent_step_invalido", f"{onde}.agent_step.workflow: nome do fluxo remoto.")
            _int(a.get("version"), f"{onde}.agent_step.version", 1, 10**6)
            if not isinstance(a.get("expect_sha256"), str) or not SHA_RE.match(a["expect_sha256"]):
                raise _erro("agent_step_invalido", f"{onde}.agent_step.expect_sha256: hash (64 hex) do fluxo remoto aprovado.")
            if "timeout" not in a:
                raise _erro("agent_step_invalido", f"{onde}.agent_step.timeout é obrigatório.")
            duracao_s(a["timeout"], f"{onde}.agent_step.timeout")
            ps = a.get("params", {})
            if not isinstance(ps, dict) or len(ps) > 20:
                raise _erro("agent_step_invalido", f"{onde}.agent_step.params: objeto com até 20 campos.")
            for k, v in ps.items():
                _ident(k, f"{onde}.agent_step.params.{k}")
                if not isinstance(v, (str, int, bool)):
                    raise _erro("agent_step_invalido", f"{onde}.agent_step.params.{k}: texto, inteiro ou booleano.")
        elif tipo == "if":
            condicoes[nid] = analisar_condicao(no["if"])
            if "then" not in no or "else" not in no:
                raise _erro("ramo_faltando", f"{onde}: `if` precisa de `then` e `else`.")
        elif tipo == "switch":
            if not isinstance(no["switch"], str) or not re.match(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$", no["switch"]):
                raise _erro("switch_invalido", f"{onde}.switch: referência `no.saida` a uma saída choice.")
            casos = no.get("cases")
            if not isinstance(casos, dict) or not casos or "default" not in no:
                raise _erro("switch_invalido", f"{onde}: `switch` precisa de `cases` e `default`.")
            for k in casos:
                if not VALOR_RE.match(k):
                    raise _erro("switch_invalido", f"{onde}.cases: opção {k!r} inválida.")
        elif tipo == "for_each":
            f = _chaves(no["for_each"], {"item", "in", "max"}, f"{onde}.for_each")
            _ident(f.get("item"), f"{onde}.for_each.item")
            _int(f.get("max"), f"{onde}.for_each.max", 1, FOR_EACH_MAX)
            ref = f.get("in")
            if not isinstance(ref, str) or not ref.startswith("params.") or ref[7:] not in params \
                    or params[ref[7:]]["type"] != "list":
                raise _erro("for_each_invalido", f"{onde}.for_each.in: `params.<lista>` declarado como list.")
            if params[ref[7:]]["max"] > f["max"]:
                raise _erro("for_each_invalido", f"{onde}: a lista pode ter {params[ref[7:]]['max']} itens, "
                                                  f"mais que o max do laço ({f['max']}).")
        elif tipo == "repeat_until":
            r = _chaves(no["repeat_until"], {"until", "max"}, f"{onde}.repeat_until")
            _int(r.get("max"), f"{onde}.repeat_until.max", 1, REPEAT_MAX)
            condicoes[nid] = analisar_condicao(r.get("until"))
        elif tipo == "approval":
            if no["approval"] is not True:
                raise _erro("formato_invalido", f"{onde}: use `approval: true`.")
        elif tipo == "fail":
            _moldes(no["fail"], f"{onde}.fail")
        elif tipo == "end":
            if no["end"] is not True:
                raise _erro("formato_invalido", f"{onde}: use `end: true`.")
        if tipo in LACOS and ("body" not in no or "after" not in no):
            raise _erro("laco_invalido", f"{onde}: laço precisa de `body` e `after`.")

    inicio = lista[0]["id"]
    _checar_aciclico(nos)  # antes das regiões: um ciclo dá o erro mais claro
    regiao, profundidade = _regioes(nos, inicio)
    for nid, no in nos.items():
        if no["_tipo"] not in TERMINAIS and no["_tipo"] not in ("if", "switch") and "next" not in no \
                and regiao[nid] is None and no["_tipo"] not in LACOS:
            raise _erro("caminho_sem_fim", f"Nó `{nid}` não tem `next`: todo caminho termina em `end` ou `fail`.")
        if no.get("on_timeout") and no["on_timeout"] not in nos:
            raise _erro("destino_inexistente", f"Nó `{nid}`: on_timeout aponta para `{no['on_timeout']}`, que não existe.")
    if max(profundidade.values(), default=0) > ANINHAMENTO_MAX:
        raise _erro("laco_aninhado", f"No máximo {ANINHAMENTO_MAX} níveis de laço aninhado.")
    _checar_referencias(nos, params, saidas_de, condicoes, regiao)
    pior = _pior_caso(nos, inicio)
    if pior > max_passos:
        raise _erro("pior_caso_alto", f"No pior caso o fluxo roda {pior} passos, acima do limite ({max_passos}).")
    canon = json.loads(canonico(doc))
    return Fluxo(doc=canon, sha256=sha256_de(doc), nos=nos, inicio=inicio, regiao=regiao, pior_caso=pior,
                 condicoes=condicoes)


def destinos(no: dict) -> list[str]:
    """Arestas explícitas (sem a ida do laço para o corpo, que é tratada à parte)."""
    saida = [no[k] for k in ("next", "then", "else", "default", "after", "on_timeout") if isinstance(no.get(k), str)]
    if isinstance(no.get("cases"), dict):
        saida += [v for v in no["cases"].values() if isinstance(v, str)]
    return saida


def _regioes(nos: dict[str, dict], inicio: str) -> tuple[dict[str, str | None], dict[str, int]]:
    """Cada nó pertence a uma região: o nível de cima ou o corpo de um laço. Um nó em duas regiões é recusado."""
    regiao: dict[str, str | None] = {}
    profundidade: dict[str, int] = {}
    fila: list[tuple[str, str | None, int]] = [(inicio, None, 0)]
    while fila:
        nid, dono, prof = fila.pop()
        if nid not in nos:
            raise _erro("destino_inexistente", f"Seta aponta para `{nid}`, que não existe.")
        if nid in regiao:
            if regiao[nid] != dono:
                raise _erro("no_compartilhado", f"Nó `{nid}` está dentro e fora de um laço; duplique o nó.")
            continue
        regiao[nid], profundidade[nid] = dono, prof
        no = nos[nid]
        for d in destinos(no):
            fila.append((d, dono, prof))
        if no["_tipo"] in LACOS:
            fila.append((no["body"], nid, prof + 1))
    soltos = set(nos) - set(regiao)
    if soltos:
        raise _erro("no_inalcancavel", f"Nó(s) que nenhum caminho alcança: {', '.join(sorted(soltos))}.")
    for nid, no in nos.items():
        if no["_tipo"] in LACOS and regiao[no["body"]] != nid:
            raise _erro("no_compartilhado", f"O corpo do laço `{nid}` também é usado fora dele.")
    return regiao, profundidade


def _checar_aciclico(nos: dict[str, dict]) -> None:
    """Setas explícitas formam um DAG: repetir só por nó de laço (que tem max)."""
    estado: dict[str, int] = {}

    def visitar(nid: str, pilha: list[str]) -> None:
        estado[nid] = 1
        alvos = destinos(nos[nid]) + ([nos[nid]["body"]] if nos[nid]["_tipo"] in LACOS else [])
        for d in alvos:
            if d not in nos:
                raise _erro("destino_inexistente", f"Seta de `{nid}` aponta para `{d}`, que não existe.")
            if estado.get(d) == 1:
                raise _erro("ciclo_sem_laco", f"Ciclo sem nó de laço: {' → '.join(pilha + [nid, d])}. Use for_each/repeat_until.")
            if d not in estado:
                visitar(d, pilha + [nid])
        estado[nid] = 2

    for nid in nos:
        if nid not in estado:
            visitar(nid, [])


def _laços_acima(nid: str, nos: dict[str, dict], regiao: dict[str, str | None]) -> list[str]:
    acima, r = [], regiao[nid]
    while r is not None:
        acima.append(r)
        r = regiao[r]
    return acima


def _checar_referencias(nos: dict, params: dict, saidas_de: dict, condicoes: dict, regiao: dict) -> None:
    """Moldes `{x}` e refs de condição apontam para coisas declaradas e visíveis naquele ponto."""
    for chave, arvore in condicoes.items():
        nid = chave.split("#")[0]
        itens = {nos[l]["for_each"]["item"] for l in _laços_acima(nid, nos, regiao) if nos[l]["_tipo"] == "for_each"}
        if nos[nid]["_tipo"] == "repeat_until":
            itens_laco = {f"{nid}.index"}
        else:
            itens_laco = set()
        for ref in refs_da_condicao(arvore):
            if "." not in ref:
                if ref not in itens:
                    raise _erro("referencia_inexistente", f"Nó `{nid}`: `{ref}` não é item de laço visível aqui.")
                continue
            base, campo = ref.split(".", 1)
            if base == "params":
                if campo not in params:
                    raise _erro("referencia_inexistente", f"Nó `{nid}`: parâmetro `{campo}` não declarado.")
            elif base in nos and nos[base]["_tipo"] in LACOS and campo == "index":
                if base not in _laços_acima(nid, nos, regiao) and ref not in itens_laco:
                    raise _erro("referencia_inexistente", f"Nó `{nid}`: `{ref}` só vale dentro do laço `{base}`.")
            elif base not in nos or campo not in saidas_de.get(base, {}):
                raise _erro("referencia_inexistente", f"Nó `{nid}`: `{ref}` não é uma saída declarada.")
    for nid, no in nos.items():
        if no["_tipo"] == "switch":
            base, campo = no["switch"].split(".", 1)
            decl = saidas_de.get(base, {}).get(campo)
            if not decl or decl["type"] != "choice":
                raise _erro("switch_invalido", f"Nó `{nid}`: `{no['switch']}` não é uma saída choice declarada.")
            sobra = set(no["cases"]) - set(decl["from"])
            if sobra:
                raise _erro("switch_invalido", f"Nó `{nid}`: caso(s) fora das opções: {', '.join(sorted(sobra))}.")
        visiveis = set(params) | {nos[l]["for_each"]["item"] for l in _laços_acima(nid, nos, regiao)
                                  if nos[l]["_tipo"] == "for_each"}
        usados: set[str] = set()
        t = no["_tipo"]
        if t == "clone":
            usados = set(MOLDE_RE.findall(no["clone"])) | set(MOLDE_RE.findall(no.get("ref", "")))
        elif t == "run":
            usados = _args(no["run"], nid)
        elif t == "serve":
            usados = _args(no["serve"]["command"], nid)
        elif t in ("agent", "fail"):
            usados = set(MOLDE_RE.findall(no[t]))
        elif t == "agent_step":
            for v in no["agent_step"].get("params", {}).values():
                if isinstance(v, str):
                    usados |= set(MOLDE_RE.findall(v))
        falta = usados - visiveis
        if falta:
            raise _erro("molde_inexistente", f"Nó `{nid}`: {{{', '.join(sorted(falta))}}} não é parâmetro nem item de laço.")


def _custo(no: dict) -> int:
    return 1 + int(no.get("retry", {}).get("times", 0))


def _pior_caso(nos: dict[str, dict], inicio: str) -> int:
    """Maior número de passos possível: caminho mais longo no DAG, com laço = max × corpo."""
    memo: dict[str, int] = {}

    def maior(nid: str) -> int:
        if nid in memo:
            return memo[nid]
        no = nos[nid]
        if no["_tipo"] in LACOS:
            vezes = no["for_each"]["max"] if no["_tipo"] == "for_each" else no["repeat_until"]["max"]
            proprio = 1 + vezes * maior(no["body"])
            seguintes = [no["after"]]
        else:
            proprio = _custo(no)
            seguintes = [d for d in destinos(no) if d != no.get("after")]
        memo[nid] = proprio + max((maior(d) for d in seguintes), default=0)
        return memo[nid]

    return maior(inicio)


def ler_fluxo(texto: str) -> dict:
    """JSON -> dict. YAML fica fora (o servidor e o executor são só stdlib); o editor manda JSON."""
    try:
        doc = json.loads(texto)
    except ValueError as e:
        raise _erro("json_invalido", f"Fluxo não é JSON válido: {e}.") from None
    if not isinstance(doc, dict):
        raise _erro("formato_invalido", "O fluxo deve ser um objeto JSON.")
    return doc


# --- Parâmetros de um pedido -------------------------------------------------

def validar_parametros(fluxo: Fluxo, valores: object, repos_aprovados: list[str] | None = None) -> dict[str, object]:
    """Valores de um pedido contra os parâmetros declarados. Nada além do declarado entra."""
    if not isinstance(valores, dict):
        raise _erro("params_invalidos", "Parâmetros do pedido devem ser um objeto.")
    decl = fluxo.doc.get("params", {})
    sobra = set(valores) - set(decl)
    if sobra:
        raise _erro("params_invalidos", f"Parâmetro(s) não declarado(s): {', '.join(sorted(sobra))}.")
    saida: dict[str, object] = {}
    for nome, p in decl.items():
        if nome not in valores:
            raise _erro("params_invalidos", f"Falta o parâmetro `{nome}`.")
        v = valores[nome]
        if p["type"] == "integer":
            if not isinstance(v, int) or isinstance(v, bool) or not p.get("min", 0) <= v <= p.get("max", 10**9):
                raise _erro("params_invalidos", f"`{nome}`: inteiro de {p.get('min', 0)} a {p.get('max', 10**9)}.")
        elif p["type"] == "boolean":
            if not isinstance(v, bool):
                raise _erro("params_invalidos", f"`{nome}`: true ou false.")
        elif p["type"] == "choice":
            opcoes = repos_aprovados if p["from"] == REPOS_APROVADOS else p["from"]
            if opcoes is None or v not in opcoes:
                raise _erro("params_invalidos", f"`{nome}`: {v!r} não está entre as opções permitidas.")
        elif p["type"] == "list":
            if not isinstance(v, list) or not 1 <= len(v) <= p["max"] or any(x not in p["from"] for x in v) \
                    or len(set(v)) != len(v):
                raise _erro("params_invalidos", f"`{nome}`: lista de 1–{p['max']} opções entre {p['from']}.")
        saida[nome] = v
    return saida


def preencher(texto: str, valores: dict[str, object]) -> str:
    """Troca `{x}` pelo valor. Só roda depois da validação, então todo molde tem valor."""
    return MOLDE_RE.sub(lambda m: str(valores[m.group(1)]), texto)


def preencher_valor(v: object, valores: dict[str, object]) -> object:
    """Parâmetro de agent_step: `"{pr}"` sozinho mantém o tipo (inteiro continua inteiro); o resto vira texto."""
    if isinstance(v, str):
        m = MOLDE_RE.fullmatch(v)
        return valores[m.group(1)] if m else preencher(v, valores)
    return v


def validar_saidas_recebidas(declaradas: dict, recebidas: object, onde: str) -> dict[str, object]:
    """Saídas de um `agent`/`agent_step`: exatamente as declaradas, cada uma no tipo certo."""
    if not isinstance(recebidas, dict) or set(recebidas) != set(declaradas):
        raise _erro("saida_recusada", f"{onde}: esperava as saídas {sorted(declaradas)}.")
    for nome, d in declaradas.items():
        v = recebidas[nome]
        ok = (d["type"] == "integer" and isinstance(v, int) and not isinstance(v, bool)) \
            or (d["type"] == "boolean" and isinstance(v, bool)) \
            or (d["type"] == "choice" and v in d["from"])
        if not ok:
            raise _erro("saida_recusada", f"{onde}: saída `{nome}` = {v!r} fora do tipo declarado.")
    return dict(recebidas)


def validar_cadeia(cadeia: object, eu: str) -> list[str]:
    """Fluxos entre IAs: `chain` é a lista `agente:fluxo@versao` já percorrida. Recusa ciclo e profundidade > 3."""
    if not isinstance(cadeia, list) or not all(isinstance(c, str) and len(c) <= 120 for c in cadeia):
        raise _erro("cadeia_invalida", "chain: lista de `agente:fluxo@versao`.")
    if len(cadeia) >= SALTOS_MAX:
        raise _erro("cadeia_longa", f"Cadeia de pedidos passou de {SALTOS_MAX} saltos.")
    if eu in cadeia:
        raise _erro("cadeia_ciclo", f"{eu} já está na cadeia ({' → '.join(cadeia)}): ciclo entre agentes.")
    return cadeia
