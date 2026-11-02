/**
 * Fluxo como grafo (docs/PLANO-FLUXOS.md, seção 11): leitura do documento, setas, layout automático,
 * checagem local rápida e simulação. A validação de verdade é a do servidor (relay_fluxos.validar),
 * que roda de novo ao publicar; aqui só pegamos o grosso enquanto se edita.
 */

export const TIPOS_NO = ["clone", "run", "serve", "agent", "agent_step", "if", "switch", "for_each", "repeat_until",
  "approval", "fail", "end"] as const;
export type TipoNo = (typeof TIPOS_NO)[number];

export type Valor = string | number | boolean | Valor[] | { [k: string]: Valor };
export type No = { id: string } & Record<string, Valor>;
export type Layout = Record<string, [number, number]>;

export interface DocFluxo {
  name: string;
  version: number;
  description?: string;
  params?: Record<string, Record<string, Valor>>;
  environment: { image: string; network?: string[]; timeout?: string };
  limits?: { max_steps?: number; timeout?: string };
  nodes?: No[];
  steps?: Record<string, Valor>[];
  layout?: Layout;
}

const ID_RE = /^[a-z][a-z0-9_]{0,39}$/;
const NOME_RE = /^[a-z][a-z0-9-]{0,47}$/;
const LACOS: TipoNo[] = ["for_each", "repeat_until"];
const TERMINAIS: TipoNo[] = ["fail", "end"];

export const tipoDe = (no: No): TipoNo | null => {
  const tipos = TIPOS_NO.filter((t) => t in no);
  return tipos.length === 1 ? tipos[0]! : null;
};

/** `steps` (formato linear) vira `nodes` encadeados, igual ao servidor. */
export function nosDe(doc: DocFluxo): No[] {
  if (doc.nodes) return doc.nodes;
  const steps = doc.steps ?? [];
  return [
    ...steps.map((s, i) => ({ ...s, id: `step_${i + 1}`, next: i + 1 < steps.length ? `step_${i + 2}` : "end" }) as No),
    { id: "end", end: true },
  ];
}

/** Uma saída de nó: `porta` é a chave do JSON que guarda o destino (`case:<valor>` para switch). */
export interface Seta {
  de: string;
  para: string;
  porta: string;
}

export function portasDe(no: No): string[] {
  const tipo = tipoDe(no);
  if (!tipo || TERMINAIS.includes(tipo)) return [];
  if (tipo === "if") return ["then", "else"];
  if (tipo === "switch") return [...Object.keys((no.cases as Record<string, string>) ?? {}).map((k) => `case:${k}`), "default"];
  if (LACOS.includes(tipo)) return ["body", "after"];
  return tipo === "agent_step" ? ["next", "on_timeout"] : ["next"];
}

export function destinoDe(no: No, porta: string): string | undefined {
  if (porta.startsWith("case:")) return (no.cases as Record<string, string> | undefined)?.[porta.slice(5)];
  const v = no[porta];
  return typeof v === "string" ? v : undefined;
}

/** Devolve o nó com a porta apontando para `para` (ou sem ela, se `para` for undefined). */
export function ligar(no: No, porta: string, para: string | undefined): No {
  if (porta.startsWith("case:")) {
    const cases = { ...((no.cases as Record<string, string>) ?? {}) };
    if (para === undefined) delete cases[porta.slice(5)];
    else cases[porta.slice(5)] = para;
    return { ...no, cases };
  }
  const novo: No = { ...no };
  if (para === undefined) delete novo[porta];
  else novo[porta] = para;
  return novo;
}

export function setasDe(nos: No[]): Seta[] {
  const ids = new Set(nos.map((n) => n.id));
  return nos.flatMap((no) => portasDe(no).flatMap((porta) => {
    const para = destinoDe(no, porta);
    return para && ids.has(para) ? [{ de: no.id, para, porta }] : [];
  }));
}

export const LARGURA_NO = 200;
const PASSO_X = 240, PASSO_Y = 110;

/** Camadas pelo caminho mais longo a partir do início; posições guardadas em `layout` têm preferência. */
export function organizar(nos: No[], layout?: Layout | null, forcar = false): Layout {
  const setas = setasDe(nos);
  const camada = new Map<string, number>();
  if (nos[0]) camada.set(nos[0].id, 0);
  // Grafo é acíclico (o servidor garante); limitar as voltas protege de rascunho com ciclo.
  for (let volta = 0; volta < nos.length; volta++) {
    let mudou = false;
    for (const s of setas) {
      const c = camada.get(s.de);
      if (c !== undefined && (camada.get(s.para) ?? -1) < c + 1) { camada.set(s.para, c + 1); mudou = true; }
    }
    if (!mudou) break;
  }
  let solto = Math.max(0, ...camada.values()) + 1;
  for (const n of nos) if (!camada.has(n.id)) camada.set(n.id, solto++);
  const porCamada = new Map<number, string[]>();
  for (const n of nos) porCamada.set(camada.get(n.id)!, [...(porCamada.get(camada.get(n.id)!) ?? []), n.id]);
  const saida: Layout = {};
  for (const [c, ids] of porCamada)
    ids.forEach((id, i) => { saida[id] = [Math.round((i - (ids.length - 1) / 2) * PASSO_X), c * PASSO_Y]; });
  if (!forcar && layout) for (const [id, pos] of Object.entries(layout)) if (id in saida) saida[id] = pos;
  return saida;
}

export interface Problema {
  no?: string;
  texto: string;
}

/** Checagem local: o que dá para ver sem o servidor. Não substitui a validação ao publicar. */
export function checar(doc: DocFluxo): Problema[] {
  const p: Problema[] = [];
  if (!NOME_RE.test(doc.name ?? "")) p.push({ texto: "Nome: minúsculas, números e hífen, começando com letra." });
  if (!Number.isInteger(doc.version) || doc.version < 1) p.push({ texto: "Versão deve ser um inteiro a partir de 1." });
  if (!doc.environment?.image) p.push({ texto: "Falta a imagem do container (environment.image)." });
  const nos = nosDe(doc);
  if (nos.length === 0) p.push({ texto: "O fluxo precisa de pelo menos um nó." });
  const ids = new Set<string>();
  for (const no of nos) {
    if (!ID_RE.test(no.id)) p.push({ no: no.id, texto: `Id “${no.id}” inválido: minúsculas, números e _.` });
    if (ids.has(no.id)) p.push({ no: no.id, texto: `Id “${no.id}” repetido.` });
    ids.add(no.id);
  }
  // Nós alcançados pelo corpo de um laço podem terminar sem `next` (o laço volta sozinho).
  const noCorpo = new Set<string>();
  const porId = new Map(nos.map((n) => [n.id, n]));
  for (const no of nos) {
    let atual = typeof no.body === "string" ? porId.get(no.body) : undefined;
    for (let i = 0; atual && i < nos.length; i++) {
      noCorpo.add(atual.id);
      atual = typeof atual.next === "string" ? porId.get(atual.next) : undefined;
    }
  }
  for (const no of nos) {
    const tipo = tipoDe(no);
    if (!tipo) { p.push({ no: no.id, texto: `Nó “${no.id}” precisa de exatamente um tipo.` }); continue; }
    for (const porta of portasDe(no)) {
      const para = destinoDe(no, porta);
      if (para && !ids.has(para)) p.push({ no: no.id, texto: `${no.id} → ${para}: esse nó não existe.` });
    }
    if (tipo === "if" && (!no.then || !no.else)) p.push({ no: no.id, texto: `“${no.id}”: o Se precisa dos dois ramos (então e senão).` });
    if (tipo === "switch" && !no.default) p.push({ no: no.id, texto: `“${no.id}”: o Escolher precisa do ramo padrão.` });
    if (LACOS.includes(tipo) && (!no.body || !no.after)) p.push({ no: no.id, texto: `“${no.id}”: o laço precisa de corpo e de depois.` });
    if (!TERMINAIS.includes(tipo) && !["if", "switch", ...LACOS].includes(tipo) && !no.next && !noCorpo.has(no.id))
      p.push({ no: no.id, texto: `“${no.id}” não tem próximo: todo caminho termina em Fim ou Falhar.` });
  }
  return p;
}

/** Escolhas da simulação: ramo de cada `if`/`switch` (nó -> porta). */
export type Escolhas = Record<string, string>;

export interface Caminho {
  nos: string[];
  setas: Set<string>;
  fim: "end" | "fail" | "sem_saida" | "limite";
}

export const chaveSeta = (s: Pick<Seta, "de" | "porta">) => `${s.de}:${s.porta}`;

/** Percorre o grafo com as escolhas dadas. Laços rodam o corpo uma vez. Não executa nada. */
export function simular(nos: No[], escolhas: Escolhas): Caminho {
  const porId = new Map(nos.map((n) => [n.id, n]));
  const caminho: Caminho = { nos: [], setas: new Set(), fim: "sem_saida" };
  const pilha: string[] = []; // `after` dos laços abertos
  let atual = nos[0];
  while (atual) {
    if (caminho.nos.length >= 200) { caminho.fim = "limite"; return caminho; }
    caminho.nos.push(atual.id);
    const tipo = tipoDe(atual);
    if (tipo === "end" || tipo === "fail") { caminho.fim = tipo; return caminho; }
    let porta: string;
    if (tipo === "if") porta = escolhas[atual.id] ?? "then";
    else if (tipo === "switch") porta = escolhas[atual.id] ?? "default";
    else if (tipo && LACOS.includes(tipo)) {
      if (typeof atual.after === "string") pilha.push(atual.after);
      porta = "body";
    } else porta = "next";
    let para = destinoDe(atual, porta);
    if (para) caminho.setas.add(chaveSeta({ de: atual.id, porta }));
    else if (pilha.length) para = pilha.pop(); // fim do corpo: segue o `after` do laço
    atual = para ? porId.get(para) : undefined;
  }
  return caminho;
}

/** Rótulos da interface; o arquivo continua em inglês. */
export const ROTULOS: Record<TipoNo, string> = {
  clone: "Clonar", run: "Rodar", serve: "Servir", agent: "Agente", agent_step: "Pedir a outro agente",
  if: "Se", switch: "Escolher", for_each: "Para cada", repeat_until: "Repetir até", approval: "Aprovação",
  fail: "Falhar", end: "Fim",
};

export const ROTULO_PORTA: Record<string, string> = {
  next: "", then: "então", else: "senão", body: "corpo", after: "depois", default: "padrão", on_timeout: "tempo esgotado",
};
export const rotuloPorta = (porta: string) => porta.startsWith("case:") ? porta.slice(5) : (ROTULO_PORTA[porta] ?? porta);

/** Resumo de uma linha do que o nó faz, para o cartão no quadro. */
export function resumoNo(no: No): string {
  const tipo = tipoDe(no);
  if (!tipo) return "";
  const v = no[tipo];
  if (tipo === "run" && Array.isArray(v)) return v.join(" ");
  if (tipo === "serve" && typeof v === "object" && v && !Array.isArray(v)) {
    const s = v as { command?: string[]; port?: number };
    return `${(s.command ?? []).join(" ")}${s.port ? ` :${s.port}` : ""}`;
  }
  if (tipo === "for_each" && typeof v === "object" && !Array.isArray(v)) {
    const f = v as { item?: string; in?: string; max?: number };
    return `${f.item} em ${f.in} (máx. ${f.max})`;
  }
  if (tipo === "repeat_until" && typeof v === "object" && !Array.isArray(v)) {
    const r = v as { until?: string; max?: number };
    return `${r.until} (máx. ${r.max})`;
  }
  if (tipo === "agent_step" && typeof v === "object" && !Array.isArray(v)) {
    const a = v as { agent?: string; workflow?: string; version?: number };
    return `@${a.agent} ${a.workflow}@${a.version}`;
  }
  if (tipo === "end" || tipo === "approval") return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Nó novo de cada tipo, já no formato que o servidor aceita (falta só ligar as setas). */
export function noNovo(tipo: TipoNo, id: string): No {
  const base: Record<TipoNo, Record<string, Valor>> = {
    clone: { clone: "{repo}", ref: "main" },
    run: { run: ["npm", "test"], outputs: { exit_code: "integer" } },
    serve: { serve: { command: ["npx", "vite", "preview", "--port", "4173"], port: 4173 } },
    agent: { agent: "Descreva a tarefa do agente." },
    agent_step: { agent_step: { agent: "claude-x", workflow: "nome-do-fluxo", version: 1, expect_sha256: "0".repeat(64), timeout: "10m" } },
    if: { if: "passo.exit_code == 0" },
    switch: { switch: "passo.saida", cases: {} },
    for_each: { for_each: { item: "item", in: "params.lista", max: 5 } },
    repeat_until: { repeat_until: { until: "passo.exit_code == 0", max: 3 } },
    approval: { approval: true },
    fail: { fail: "Motivo da falha" },
    end: { end: true },
  };
  return { id, ...base[tipo] };
}

export function idLivre(nos: No[], tipo: TipoNo): string {
  const ids = new Set(nos.map((n) => n.id));
  for (let i = 1; ; i++) if (!ids.has(`${tipo}_${i}`)) return `${tipo}_${i}`;
}

export const MODELO: DocFluxo = {
  name: "novo-fluxo",
  version: 1,
  description: "O que este fluxo faz.",
  params: { repo: { type: "choice", from: "approved_repos" } },
  environment: { image: "node:22-bookworm", network: ["github.com", "registry.npmjs.org"], timeout: "15m" },
  limits: { max_steps: 40, timeout: "20m" },
  nodes: [
    { id: "clone", clone: "{repo}", ref: "main", next: "install" },
    { id: "install", run: ["npm", "ci"], outputs: { exit_code: "integer" }, next: "install_ok" },
    { id: "install_ok", if: "install.exit_code == 0", then: "test", else: "failed" },
    { id: "test", run: ["npm", "test"], outputs: { exit_code: "integer" }, next: "done" },
    { id: "failed", fail: "npm ci falhou" },
    { id: "done", end: true },
  ],
};
