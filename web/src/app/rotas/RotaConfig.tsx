import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Navigate } from "@tanstack/react-router";
import { ArrowLeftIcon, BotIcon, CheckIcon, CopyIcon, KeyRoundIcon, UserIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { avisar } from "@/shared/lib/avisar";
import { z } from "zod";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSessao } from "@/features/auth/sessao";
import { useAgentes, useCriarAgente, useRevogarAgente } from "@/features/agentes/useAgentes";
import { cn } from "@/lib/utils";
import { traduzirErro } from "@/shared/api/erros";
import type { AgenteCriado } from "@/shared/api/tipos";
import { corDe, horaDe, normalizarNome } from "@/shared/lib/formato";
import { ler } from "@/shared/lib/armazenamento";
import { textos } from "@/shared/lib/textos";

const t = textos.config;

const esquema = z.object({
  nome: z.string().trim().min(1, textos.validacao.nomeObrigatorio).max(32, textos.validacao.nomeLongo)
    .transform(normalizarNome).refine((n) => n.length > 0, textos.validacao.nomeInvalido),
  tipo: z.enum(["ia", "humano"]),
});

export function RotaConfig() {
  const { estado, admin } = useSessao();
  const { data: agentes, isPending } = useAgentes();
  const criar = useCriarAgente();
  const revogar = useRevogarAgente();
  const [criado, setCriado] = useState<AgenteCriado | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [revogando, setRevogando] = useState<string | null>(null);
  const form = useForm<z.input<typeof esquema>, unknown, z.output<typeof esquema>>({
    resolver: zodResolver(esquema),
    defaultValues: { nome: "", tipo: "ia" },
  });
  const { register, handleSubmit, setError, reset, watch, setValue, formState: { errors, isSubmitting } } = form;
  const tipo = watch("tipo");

  if (estado === "fora") return <Navigate to="/entrar" replace />;
  if (estado === "dentro" && !admin) return <Navigate to="/" replace />;

  const aoCriar = handleSubmit(async (dados) => {
    try {
      setCriado(await criar.mutateAsync(dados));
      setCopiado(false);
      reset({ nome: "", tipo: dados.tipo });
    } catch (e) {
      const { mensagem, campo } = traduzirErro(e);
      setError(campo === "nome" ? "nome" : "root", { message: mensagem });
    }
  });

  async function copiarToken() {
    if (!criado) return;
    try {
      await navigator.clipboard.writeText(criado.token);
      setCopiado(true);
    } catch {
      avisar("erro", textos.conversa.naoCopiou);
    }
  }

  return (
    <main className="h-dvh overflow-y-auto bg-background">
      <div className="mx-auto grid max-w-3xl gap-6 px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-10 md:px-6">
        <header className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label={t.voltar}
            render={<Link to="/s/$sala" params={{ sala: ler("relay-sala") ?? "geral" }} />}>
            <ArrowLeftIcon />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t.titulo}</h1>
            <p className="text-sm text-muted-foreground">{t.subtitulo}</p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRoundIcon className="size-4" /> {t.novoTitulo}</CardTitle>
            <CardDescription>{t.novoDescricao}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={aoCriar} noValidate>
              <FieldGroup className="gap-4 sm:flex-row sm:items-start">
                <Field data-invalid={Boolean(errors.nome)} className="flex-1">
                  <FieldLabel htmlFor="novo-nome">{t.nome}</FieldLabel>
                  <Input id="novo-nome" {...register("nome")} placeholder="claude-julio" className="h-10 font-mono" aria-invalid={Boolean(errors.nome)} />
                  <FieldError errors={[errors.nome]} />
                </Field>
                <Field className="sm:w-auto">
                  <FieldLabel>{t.tipo}</FieldLabel>
                  <div role="radiogroup" aria-label={t.tipo} className="flex rounded-lg border p-0.5">
                    {(["ia", "humano"] as const).map((v) => (
                      <button key={v} type="button" role="radio" aria-checked={tipo === v} onClick={() => setValue("tipo", v)}
                        className={cn("flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
                          tipo === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                        {v === "ia" ? <BotIcon className="size-3.5" /> : <UserIcon className="size-3.5" />}
                        {v === "ia" ? t.ia : t.humano}
                      </button>
                    ))}
                  </div>
                </Field>
                <Button type="submit" disabled={isSubmitting} className="h-10 sm:mt-[1.6rem]">{t.criar}</Button>
              </FieldGroup>
              {errors.root && <p role="alert" className="mt-3 text-sm text-destructive">{errors.root.message}</p>}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.listaTitulo}</CardTitle>
            <CardDescription>{t.listaDescricao}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6 sm:pl-2">{t.nome}</TableHead>
                  <TableHead>{t.status}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t.token}</TableHead>
                  <TableHead className="pr-6 text-right sm:pr-2"><span className="sr-only">{t.acoes}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isPending && Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={i}><TableCell colSpan={4} className="px-6 sm:px-2"><Skeleton className="h-6" /></TableCell></TableRow>
                ))}
                {agentes?.map((a) => (
                  <TableRow key={a.nome}>
                    <TableCell className="pl-6 sm:pl-2">
                      <span className="flex items-center gap-2 font-medium">
                        <i className="size-2 rounded-full" style={{ background: corDe(a.nome) }} />
                        {a.nome}
                        <Badge variant="outline" className="font-normal">{a.tipo === "ia" ? t.ia : t.humano}</Badge>
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.online
                        ? <span className="flex items-center gap-1.5 text-ok"><i className="size-1.5 rounded-full bg-ok" />{textos.conversa.online}</span>
                        : <span className="text-muted-foreground">{a.visto_em ? textos.conversa.vistoAs(horaDe(Date.parse(a.visto_em))) : t.nunca}</span>}
                    </TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">
                      {a.tem_token ? <Badge variant="secondary">{t.ativo}</Badge> : <span className="text-muted-foreground">{t.semToken}</span>}
                    </TableCell>
                    <TableCell className="pr-6 text-right sm:pr-2">
                      {a.tem_token && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRevogando(a.nome)}>{t.revogar}</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={criado !== null} onOpenChange={(a) => { if (!a) setCriado(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.tokenDe(criado?.nome ?? "")}</DialogTitle>
            <DialogDescription>{t.tokenUmaVez}</DialogDescription>
          </DialogHeader>
          <code className="block rounded-lg border bg-muted p-3 font-mono text-xs break-all select-all">{criado?.token}</code>
          <p className="text-xs text-muted-foreground">{t.comoUsar}</p>
          <DialogFooter>
            <Button onClick={() => void copiarToken()}>{copiado ? <><CheckIcon /> {t.copiado}</> : <><CopyIcon /> {t.copiar}</>}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revogando !== null} onOpenChange={(a) => { if (!a) setRevogando(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.revogarTitulo(revogando ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>{t.revogarDescricao}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{textos.conversa.cancelar}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => {
              if (revogando) revogar.mutate(revogando, { onError: (e) => avisar("erro", traduzirErro(e).mensagem) });
            }}>{t.revogar}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
