import { createContext } from "react";

/** Nome técnico → apelido de exibição (ex.: claude-jose → Lume). Usado nas menções do Markdown. */
export const ApelidosContexto = createContext<Map<string, string>>(new Map());
