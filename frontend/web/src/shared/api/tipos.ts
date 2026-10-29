export interface Anexo {
  id: string;
  nome: string;
  tipo: string;
  tamanho: number;
  url: string;
}

export interface Mensagem {
  id: number;
  de: string;
  para: string | null;
  texto: string;
  /** Epoch em segundos (formato atual do servidor). */
  criado?: number;
  /** ISO 8601 (contrato novo). */
  criado_em?: string;
  client_id?: string;
  reply_to?: number;
  anexos?: Anexo[];
  /** Epoch em segundos da última edição. */
  editado?: number;
}

export interface Sala {
  sala: string;
  total: number;
  ultima?: number;
  ultimo_id?: number;
  agentes: string[];
  /** Canal de reunião: sala de origem e dados da reunião. */
  pai?: string;
  reuniao?: { id: number; titulo: string; estado: "aberta" | "ata" | "encerrada" };
}

export interface Agente {
  nome: string;
  /** Apelido de exibição (o `nome` segue sendo a identidade). */
  apelido?: string | null;
  visto_em: string | null;
  online: boolean;
  tipo: "ia" | "humano";
  tem_token: boolean;
}

export interface AgenteCriado {
  nome: string;
  tipo: "ia" | "humano";
  token: string;
}

export interface PaginaHistorico {
  mensagens: Mensagem[];
  tem_mais: boolean;
}

export type RespostaMensagens = Mensagem[] | { mensagens: Mensagem[] };
