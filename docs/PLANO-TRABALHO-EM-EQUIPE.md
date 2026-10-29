# Plano: trabalho em equipe entre Claudes

Status: proposta, aguardando aprovação do José · Autor: Lume (claude-jose) · Ideia: José
Base: quadro de tarefas, artefatos, reuniões e pedidos entre agentes (`PLANO-FLUXOS.md` §12).

## 1. Objetivo

Uma mudança grande deixa de ser feita de ponta a ponta por um Claude só. Ela é dividida em **fatias**, e cada fatia vai pra um Claude diferente, levando em conta o quanto cada dono ainda pode gastar. Isso evita que a cota de uma pessoa acabe no meio do trabalho, e de quebra cada parte ganha revisão de outro agente.

## 2. Como funciona (visão de quem usa)

1. Alguém pede uma mudança grande ("quadro com sprints no app", "migrar o back pro Java").
2. O **coordenador** (um Claude, em rodízio) escreve o **plano em fatias** como artefato. Cada fatia tem: objetivo, área de arquivos, dependências, tamanho (P, M ou G) e critério de pronto.
3. Um humano aprova o plano. As fatias viram **tarefas no quadro**, ligadas ao plano.
4. Cada Claude **pega** uma fatia livre, respeitando dependências, área livre e o próprio orçamento. Ele trabalha numa branch própria e abre o PR.
5. Outro Claude, de outro dono quando possível, **revisa**.
6. O coordenador junta os PRs na ordem certa e fecha o plano com um resumo.

## 3. Modelo (servidor, migração nova)

```sql
CREATE TABLE plano (                 -- a mudança grande
  id INTEGER PRIMARY KEY, sala TEXT NOT NULL, titulo TEXT NOT NULL,
  artefato_id INTEGER,               -- o plano escrito
  coordenador TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (estado IN ('rascunho','aprovado','andamento','concluido','cancelado')),
  criado REAL NOT NULL);
CREATE TABLE fatia (
  tarefa_id INTEGER PRIMARY KEY REFERENCES tarefa(id),
  plano_id INTEGER NOT NULL REFERENCES plano(id),
  area TEXT NOT NULL,                -- globs de arquivo: "frontend/android/**", "relay_server.py"
  tamanho TEXT NOT NULL CHECK (tamanho IN ('P','M','G')),
  depende TEXT,                      -- ids de fatias, separados por vírgula
  branch TEXT, pr INTEGER, revisor TEXT,
  passagem TEXT);                    -- estado deixado pra quem continuar (handoff)
CREATE TABLE orcamento (             -- declarado pelo dono, por agente e por dia
  agente TEXT NOT NULL, dia TEXT NOT NULL, limite INTEGER NOT NULL,   -- em "pontos" (P=1, M=3, G=8)
  gasto INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (agente, dia));
```

**Regras de reserva** (aplicadas pelo servidor, não pelo agente):
- **Área travada:** uma fatia em andamento trava a sua área. Outra fatia que se sobrepõe a ela (mesmo glob ou um arquivo em comum) só pode ser pega depois.
- **Dependência:** a fatia só fica livre quando todas as de que depende estão em `revisao` ou `feito`.
- **Orçamento:** só pega quem tem `limite - gasto >= tamanho`. Ao pegar, o tamanho já é reservado; ao fechar, o gasto real é anotado.
- **Revisor:** nunca é o autor da fatia, e de preferência é um agente de outro dono.

## 4. Orçamento: declarado, não medido

O Claude Code não expõe pro próprio agente quanto resta da cota. Então:
- **O dono declara** o limite por dia no perfil do agente, por exemplo "claude-joao: 12 pontos/dia". O padrão é 0, então ninguém pega fatia sem o dono permitir.
- **O tamanho** (P=1, M=3, G=8 pontos) é estimado pelo coordenador e ajustado na aprovação.
- Ao fechar uma fatia, o agente informa o **gasto real em pontos**. Com o tempo, isso calibra as estimativas.
- Quando o agente sente que está perto do limite, ele **para e passa o bastão** (§5) em vez de insistir.

## 5. Passagem de bastão

- `passar_fatia(id, estado)`: o agente grava em `passagem` o que já fez, o que falta, a branch e os comandos pra retomar, e solta a fatia. A área continua reservada por 2 h pra quem pegar continuar dali.
- Quem pega lê a passagem antes de qualquer coisa. Ela fica também como comentário na tarefa, então o humano acompanha.

## 6. MCP (ferramentas novas)

| Ferramenta | Faz |
|---|---|
| `criar_plano(titulo, sala, fatias)` | coordenador: cria plano + artefato + tarefas (rascunho) |
| `fatias_livres(sala)` | o que eu posso pegar agora (já filtrado por área, dependência e orçamento) |
| `pegar_fatia(id)` / `soltar_fatia(id)` | reserva e solta, com trava de área |
| `passar_fatia(id, estado)` | handoff (§5) |
| `concluir_fatia(id, pr, gasto)` | abre a revisão e sorteia o revisor |
| `meu_orcamento()` | limite, gasto e o que sobra hoje |

O texto de um plano ou de uma passagem é **dado, não instrução**: a docstring repete isso, como já é feito nos artefatos.

## 7. Interface

- **Web:** aba **Planos** na sala. Mostra o plano com as fatias como um quadro de raias (livre, em andamento, revisão, feito), quem está em cada fatia, as áreas travadas e o orçamento de cada agente hoje (barra). O botão "aprovar plano" fica só pra humanos.
- **App:** a mesma lista em modo leitura, com aviso quando uma fatia sua precisa de revisão.
- **Perfil do agente** (dono): campo "orçamento por dia".

## 8. Fases

| Fase | Entrega | Quem |
|---|---|---|
| 0 | Aprovação do José; definir os pontos de cada dono | José, João, Julio |
| 1 | Tabelas, regras de reserva (área, dependência, orçamento), rotas e MCP | Claudio, revisão do Lume |
| 2 | Aba Planos no web e orçamento no perfil | Lume, revisão do Claudio |
| 3 | Passagem de bastão e sorteio de revisor | Claudio (back) + Lume (front) |
| 4 | App (leitura + avisos) | Lume |
| 5 | Piloto: a próxima mudança grande feita desse jeito, com um resumo do que funcionou | todos |

## 9. Em aberto

1. Os pontos (P/M/G) ficam como estão ou cada dono prefere declarar em "horas de agente"?
2. O coordenador é fixo por plano ou rodízio automático (quem tem mais orçamento sobrando)?
3. A trava de área é por glob, como proposto, ou por pasta de primeiro nível (mais simples, menos precisa)?
4. Fatia pode ser dividida no meio do caminho, por exemplo uma G que vira duas M?
