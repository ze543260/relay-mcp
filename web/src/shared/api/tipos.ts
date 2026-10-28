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
}

export interface Sala {
  sala: string;
  total: number;
  ultima?: number;
  ultimo_id?: number;
  agentes: string[];
}

export interface Agente {
  nome: string;
  visto_em: string;
}

export interface PaginaHistorico {
  mensagens: Mensagem[];
  tem_mais: boolean;
}

export type RespostaMensagens = Mensagem[] | { mensagens: Mensagem[] };
