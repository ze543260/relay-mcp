import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeftIcon, CheckCheckIcon, CheckIcon, SendHorizontalIcon } from "lucide-react";
import tokens from "../../../../design/tokens.json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Mensagem } from "@/features/mensagens/Mensagem";
import type { Mensagem as TMensagem } from "@/shared/api/tipos";
import { corDe } from "@/shared/lib/formato";

type Cores = Record<string, string>;

const agora = Date.now() / 1000 - 3600;
const exemplo = (id: number, de: string, texto: string, extra: Partial<TMensagem> = {}): TMensagem =>
  ({ id, de, para: null, texto, criado: agora, ...extra });

/** Demonstração das animações do produto (as mesmas classes); "reduzir movimento" desliga todas. */
function Movimento() {
  const [n, setN] = useState(1);
  const [lida, setLida] = useState(false);
  const linha = (rotulo: string, filho: React.ReactNode) => (
    <div className="flex min-h-10 items-center gap-4 text-sm"><span className="w-40 flex-none text-muted-foreground">{rotulo}</span>{filho}</div>
  );
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => { setN((x) => x + 1); setLida(false); }}>Chegou mensagem</Button>
        <Button size="sm" variant="outline" onClick={() => setLida(true)}>Marcar lida</Button>
      </div>
      {linha("Mensagem nova", <span key={n} className="rounded-lg border bg-bolha px-3 py-1.5 motion-safe:animate-[entra_var(--mov-padrao)_var(--mov-curva)]">Mensagem {n}</span>)}
      {linha("Enviada → lida", lida
        ? <CheckCheckIcon key="l" aria-label="Vista por todos" className="size-4 text-primary motion-safe:animate-[pop_150ms_var(--mov-curva)]" />
        : <CheckIcon key="e" aria-label="Entregue" className="size-4 text-muted-foreground motion-safe:animate-[pop_150ms_var(--mov-curva)]" />)}
      {linha("Selo de menção", <span key={n} className="rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground motion-safe:animate-[pop_150ms_var(--mov-curva)]">@{n}</span>)}
      {linha("Menção chegando", <span key={n} className="rounded-lg border border-primary/60 bg-primary/8 px-3 py-1.5 motion-safe:animate-[acende_600ms_var(--mov-curva)]">@jose olha isso</span>)}
      {linha("Digitando", <span className="flex gap-0.5" aria-hidden>{[0, 1, 2].map((i) => <i key={i} className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-[ponto_1.2s_infinite]" style={{ animationDelay: `${i * 150}ms` }} />)}</span>)}
      {linha("Carregando", <Skeleton className="h-4 w-48" />)}
      <p className="text-sm text-muted-foreground">Tema: o botão de sol/lua da sala revela o tema novo em círculo a partir do clique (View Transitions, 450 ms); sem suporte, cross-fade de 220 ms.</p>
    </div>
  );
}

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t py-8">
      <header>
        <h2 className="text-base font-semibold tracking-tight">{titulo}</h2>
        {descricao && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{descricao}</p>}
      </header>
      {children}
    </section>
  );
}

function Paleta({ nome, cores, tema }: { nome: string; cores: Cores; tema: "light" | "dark" }) {
  return (
    <div data-theme={tema} className="rounded-xl border p-4" style={{ background: cores.fundo, color: cores.texto, borderColor: cores.borda }}>
      <p className="mb-3 text-xs font-medium tracking-widest uppercase" style={{ color: cores.suave }}>{nome}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Object.entries(cores).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-xs">
            <span className="size-7 flex-none rounded-md border" style={{ background: v, borderColor: cores.borda }} />
            <span className="min-w-0">
              <b className="block truncate font-medium">{k}</b>
              <code className="font-mono text-[11px]" style={{ color: cores.suave }}>{v}</code>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Componentes reais (não cópias) renderizados num tema forçado. */
function Vitrine({ tema }: { tema: "light" | "dark" }) {
  const nada = () => undefined;
  return (
    <div data-theme={tema} className="grid gap-5 rounded-xl border bg-background p-4 text-foreground">
      <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{tema === "light" ? "Claro" : "Escuro"}</p>
      <div className="flex flex-wrap gap-2">
        <Button>Primário</Button>
        <Button variant="secondary">Secundário</Button>
        <Button variant="outline">Contorno</Button>
        <Button variant="ghost">Fantasma</Button>
        <Button variant="destructive">Destrutivo</Button>
        <Button disabled>Desabilitado</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>12</Badge>
        <Badge variant="secondary">ativo</Badge>
        <Badge variant="outline">IA</Badge>
        {["claude-julio", "gemma", "jose"].map((n) => (
          <Badge key={n} variant="outline" className="gap-1.5 font-normal">
            <i className="size-2 rounded-full" style={{ background: corDe(n) }} />{n}
          </Badge>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="Campo" />
        <Input placeholder="Inválido" aria-invalid defaultValue="nome com espaço" />
      </div>
      <div className="flex items-end gap-2">
        <Textarea placeholder="Mandar como jose em #geral…" className="min-h-10 flex-1 resize-none bg-card" rows={1} />
        <Button aria-label="Enviar" className="size-10 rounded-full"><SendHorizontalIcon /></Button>
      </div>
      <div className="grid gap-3">
        <Mensagem m={exemplo(1, "claude-julio", "Mensagem de **IA** com `código` e $O(n)$.")} minha={false} aoResponder={nada} />
        <Mensagem m={exemplo(2, "jose", "Minha mensagem (borda acento 35%).")} minha aoResponder={nada} />
        <Mensagem m={exemplo(3, "gemma", "@jose menção a mim: borda e fundo em acento.")} minha={false} mencionaMe aoResponder={nada} />
        <Mensagem m={exemplo(4, "jose", "Respondendo uma anterior.", { reply_to: 1 })} citada={exemplo(1, "claude-julio", "Mensagem de **IA** com código")} minha aoResponder={nada} />
        <div role="separator" className="flex items-center gap-3 text-xs font-medium text-primary">
          <span className="h-px flex-1 bg-primary/40" />Novas mensagens<span className="h-px flex-1 bg-primary/40" />
        </div>
        <Mensagem m={exemplo(-1, "jose", "Enviando (otimista)…")} minha estado="enviando" />
        <Mensagem m={exemplo(-2, "jose", "Falhou ao enviar.")} minha estado="erro" aoTentar={nada} aoDescartar={nada} />
        <div className="flex gap-3"><Skeleton className="size-8 rounded-full" /><div className="grid flex-1 gap-2"><Skeleton className="h-3 w-28" /><Skeleton className="h-10 w-3/4" /></div></div>
      </div>
    </div>
  );
}

export function RotaDs() {
  const t = tokens;
  const escala = Object.entries(t.tipo.escala);
  return (
    <main className="h-dvh overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-16 md:px-6">
        <header className="flex items-center gap-3 pb-6">
          <Button variant="ghost" size="icon" aria-label="Voltar" render={<Link to="/" />}><ArrowLeftIcon /></Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t.nome} DS <span className="font-mono text-sm text-muted-foreground">v{t.versao}</span></h1>
            <p className="text-sm text-muted-foreground">
              Fonte única em <code className="font-mono">design/tokens.json</code>; <code className="font-mono">design/gerar.py</code> gera o CSS do web e o <code className="font-mono">Tokens.kt</code> do Android.
            </p>
          </div>
        </header>

        <Secao titulo="Cor" descricao="Mesmos valores no web e no Android. O acento é reservado para ação primária, estado ativo, não lidas e menções.">
          <div className="grid gap-3 lg:grid-cols-2">
            <Paleta nome="Claro" cores={t.cor.claro} tema="light" />
            <Paleta nome="Escuro" cores={t.cor.escuro} tema="dark" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Agentes (hash do nome):</span>
            {t.cor.agentes.map((c) => <span key={c} title={c} className="size-6 rounded-full" style={{ background: c }} />)}
          </div>
        </Secao>

        <Secao titulo="Tipografia" descricao={`${t.tipo.familia} para texto, ${t.tipo["familia-mono"]} para código e tokens.`}>
          <div className="grid gap-3">
            {escala.map(([k, e]) => (
              <div key={k} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <code className="w-32 font-mono text-xs text-muted-foreground">{k}</code>
                <span style={{ fontSize: e.tamanho, lineHeight: `${e.altura}px`, fontWeight: e.peso, fontFamily: k === "codigo" ? "var(--font-mono)" : undefined }}>
                  Sala onde Claudes e pessoas conversam
                </span>
                <span className="font-mono text-xs text-muted-foreground">{e.tamanho}/{e.altura} · {e.peso}</span>
              </div>
            ))}
          </div>
        </Secao>

        <Secao titulo="Raio e espaço">
          <div className="flex flex-wrap gap-4">
            {Object.entries(t.raio).filter(([k]) => k !== "pilula").map(([k, v]) => (
              <div key={k} className="grid justify-items-center gap-1 text-xs">
                <span className="size-12 border-2 border-primary bg-accent" style={{ borderRadius: v }} />
                <code className="font-mono">{k} · {v}</code>
              </div>
            ))}
          </div>
          <div className="grid gap-1.5">
            {Object.entries(t.espaco).map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 text-xs">
                <code className="w-10 font-mono text-muted-foreground">{k}</code>
                <span className="h-2.5 rounded-sm bg-primary" style={{ width: v * 4 }} />
                <span className="font-mono text-muted-foreground">{v}px</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">Alvo de toque mínimo: {t["alvo-toque"]} px. Movimento: {t.movimento.rapido}/{t.movimento.padrao}/{t.movimento.entrada} ms, curva <code className="font-mono">{t.movimento.curva}</code>.</p>
        </Secao>

        <Secao titulo="Componentes e estados" descricao="Os componentes de produção (não cópias), nos dois temas.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Vitrine tema="light" />
            <Vitrine tema="dark" />
          </div>
        </Secao>

        <Secao titulo="Movimento" descricao="Curtas, com propósito e só transform/opacity; com “reduzir movimento” viram troca instantânea.">
          <Movimento />
        </Secao>

        <Secao titulo="Regras">
          <dl className="grid gap-3 text-sm">
            {Object.entries(t.regras).map(([k, v]) => (
              <div key={k} className="grid gap-1 sm:grid-cols-[8rem_1fr]">
                <dt className="font-medium capitalize">{k}</dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </Secao>
      </div>
    </main>
  );
}
