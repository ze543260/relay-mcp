import { textos } from "@/shared/lib/textos";
import { ErroApi } from "./cliente";

/** Campo de formulário a que um erro da API se refere (para RHF `setError`). */
export type CampoErro = "nome" | "token" | "texto" | "raiz";

interface Traducao {
  mensagem: string;
  campo: CampoErro;
}

// Por `codigo` estável do problem+json (contrato novo).
const PORCODIGO: Record<string, Traducao> = {
  token_invalido: { mensagem: "Token inválido.", campo: "token" },
  sessao_expirada: { mensagem: textos.sessao.expirada, campo: "raiz" },
  nome_invalido: { mensagem: "Nome inválido.", campo: "nome" },
  nome_em_uso: { mensagem: "Esse nome já está em uso por outro agente.", campo: "nome" },
  sala_invalida: { mensagem: "Nome de sala inválido.", campo: "raiz" },
  mensagem_grande: { mensagem: "Mensagem grande demais (máx. 64 KB).", campo: "texto" },
  credencial_detectada: { mensagem: "Parece que a mensagem tem uma credencial (token, chave, senha). Não foi enviada.", campo: "texto" },
  limite_excedido: { mensagem: "Devagar: limite de envio atingido.", campo: "texto" },
  proibido: { mensagem: "Você não tem permissão para isso.", campo: "raiz" },
  requer_humano: { mensagem: "Só quem entra com um token humano próprio confirma fatos (o token de admin não vale).", campo: "raiz" },
  conflito: { mensagem: "Alguém salvou uma versão nova enquanto você editava. Abra de novo e reaplique a sua mudança.", campo: "raiz" },
  artefato_grande: { mensagem: "Artefato grande demais (máx. 200 KB por versão).", campo: "raiz" },
  artefato_cheio: { mensagem: "Esse artefato chegou ao limite de versões. Crie um novo a partir dele.", campo: "raiz" },
  artefato_decidido: { mensagem: "O artefato já está nesse estado.", campo: "raiz" },
  fato_decidido: { mensagem: "Esse fato já foi decidido por outra pessoa.", campo: "raiz" },
  fato_nao_vigente: { mensagem: "O fato que este substituiria já mudou. Atualize e tente de novo.", campo: "raiz" },
};

// Fallback pelo status HTTP, para o servidor atual (sem `codigo`).
function porStatus(status: number): Traducao {
  if (status === 401) return { mensagem: "Token inválido.", campo: "token" };
  if (status === 403) return PORCODIGO.proibido!;
  if (status === 413) return PORCODIGO.mensagem_grande!;
  if (status === 429) return PORCODIGO.limite_excedido!;
  if (status >= 500) return { mensagem: "O servidor teve um problema. Tente de novo.", campo: "raiz" };
  return { mensagem: "Pedido inválido.", campo: "raiz" };
}

export function traduzirErro(e: unknown): Traducao {
  if (e instanceof ErroApi) return (e.codigo && PORCODIGO[e.codigo]) || porStatus(e.status);
  if (e instanceof TypeError) return { mensagem: "Servidor não respondeu. Confira a conexão.", campo: "raiz" };
  return { mensagem: "Algo deu errado.", campo: "raiz" };
}
