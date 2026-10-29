import { zodResolver } from "@hookform/resolvers/zod";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { esquemaEntrada, type Entrada, type EntradaForm } from "@/features/auth/esquema";
import { useSessao } from "@/features/auth/sessao";
import { traduzirErro } from "@/shared/api/erros";
import { ler } from "@/shared/lib/armazenamento";
import { textos } from "@/shared/lib/textos";
import { rotaEntrar } from "../router";

const t = textos.entrar;

export function RotaEntrar() {
  const { entrar, logado, motivoSaida } = useSessao();
  const { volta } = rotaEntrar.useSearch();
  const navegar = useNavigate();
  const destino = volta ?? ler("relay-sala") ?? "geral";
  const nomeSalvo = ler("relay-nome") ?? "";

  const form = useForm<EntradaForm, unknown, Entrada>({
    resolver: zodResolver(esquemaEntrada),
    defaultValues: { nome: nomeSalvo, token: "" },
  });
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = form;

  if (logado && !isSubmitting) return <Navigate to="/s/$sala" params={{ sala: destino }} replace />;

  const aoEnviar = handleSubmit(async ({ nome, token }) => {
    try {
      await entrar(nome, token);
      void navegar({ to: "/s/$sala", params: { sala: destino }, replace: true });
    } catch (e) {
      const { mensagem, campo } = traduzirErro(e);
      if (campo === "nome" || campo === "token") setError(campo, { message: mensagem }, { shouldFocus: true });
      else setError("root", { message: mensagem });
    }
  });

  const campo = "h-11 font-mono text-base md:h-10 md:text-sm";
  return (
    <main className="grid h-dvh place-items-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">{textos.app}</CardTitle>
          <CardDescription>{t.descricao}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={aoEnviar} noValidate>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.nome)}>
                <FieldLabel htmlFor="nome">{t.nome}</FieldLabel>
                <Input id="nome" {...register("nome")} placeholder={t.nomePlaceholder} autoComplete="nickname" maxLength={32}
                  aria-invalid={Boolean(errors.nome)} autoFocus={!nomeSalvo} className={campo} />
                {errors.nome ? <FieldError errors={[errors.nome]} /> : <FieldDescription>{t.nomeAjuda}</FieldDescription>}
              </Field>
              <Field data-invalid={Boolean(errors.token)}>
                <FieldLabel htmlFor="token">{t.token}</FieldLabel>
                <Input id="token" type="password" {...register("token")} placeholder={t.tokenPlaceholder} autoComplete="off"
                  aria-invalid={Boolean(errors.token)} autoFocus={Boolean(nomeSalvo)} className={campo} />
                <FieldError errors={[errors.token]} />
              </Field>
              {(errors.root?.message ?? motivoSaida) && (
                <p role="alert" className="text-sm text-destructive">{errors.root?.message ?? motivoSaida}</p>
              )}
              <Button type="submit" size="lg" disabled={isSubmitting} className="h-11">
                {isSubmitting ? t.entrando : t.botao}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
