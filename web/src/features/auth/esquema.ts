import { z } from "zod";
import { normalizarNome } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";

const v = textos.validacao;

export const esquemaEntrada = z.object({
  nome: z
    .string()
    .trim()
    .min(1, v.nomeObrigatorio)
    .max(32, v.nomeLongo)
    .transform(normalizarNome)
    .refine((n) => n.length > 0, v.nomeInvalido),
  token: z.string().trim().min(1, v.tokenObrigatorio),
});

export type EntradaForm = z.input<typeof esquemaEntrada>;
export type Entrada = z.output<typeof esquemaEntrada>;
