import "katex/dist/katex.min.css";
import "./realce.css";
import { useContext, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { ApelidosContexto } from "@/shared/lib/apelidos";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

// O texto vem de outros agentes: sanitiza a árvore ANTES do KaTeX e do highlight,
// liberando só as classes que o remark-math e os blocos de código precisam.
const esquema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./, "math-inline", "math-display"]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", "math", "math-inline", "math-display", "mencao"], "title"],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", "math", "math-display"]],
  },
};

// Agentes escrevem `$$x$$` numa linha só; o remark-math só trata como bloco se cercado por linhas.
const blocosDeFormula = (texto: string): string =>
  texto.replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, tex: string) => `$$\n${tex}\n$$`);

// @nome vira <span class="mencao"> (laranja e negrito), como no app, mostrando o apelido se houver
// (o nome técnico fica no title). Fora de código e links.
type No = { type: string; value?: string; children?: No[]; data?: Record<string, unknown> };
const MENCAO = /(^|[\s(])@([\w.-]{1,32})/g;

function remarkMencoes(apelidos: Map<string, string>) {
  const percorrer = (no: No): void => {
    if (!no.children || no.type === "link" || no.type === "inlineCode" || no.type === "code") return;
    no.children = no.children.flatMap((filho): No[] => {
      if (filho.type !== "text" || !filho.value?.includes("@")) {
        percorrer(filho);
        return [filho];
      }
      const partes: No[] = [];
      let ultimo = 0;
      for (const m of filho.value.matchAll(MENCAO)) {
        const [, antes = "", nome = ""] = m;
        const inicio = (m.index ?? 0) + antes.length;
        if (inicio > ultimo) partes.push({ type: "text", value: filho.value.slice(ultimo, inicio) });
        const apelido = [...apelidos].find(([n]) => n.toLowerCase() === nome.toLowerCase())?.[1];
        partes.push({ type: "mencao", data: { hName: "span", hProperties: { className: ["mencao"], ...(apelido ? { title: `@${nome}` } : {}) } },
          children: [{ type: "text", value: `@${apelido ?? nome}` }] });
        ultimo = inicio + nome.length + 1;
      }
      if (ultimo < filho.value.length) partes.push({ type: "text", value: filho.value.slice(ultimo) });
      return partes;
    });
  };
  return () => (arvore: No) => percorrer(arvore);
}

const componentes: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

export default function Markdown({ texto }: { texto: string }) {
  const apelidos = useContext(ApelidosContexto);
  const mencoes = useMemo(() => remarkMencoes(apelidos), [apelidos]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }], mencoes]}
      rehypePlugins={[
        [rehypeSanitize, esquema],
        [rehypeKatex, { throwOnError: false, trust: false, strict: "ignore" }],
        [rehypeHighlight, { detect: true, ignoreMissing: true }],
      ]}
      remarkRehypeOptions={{ clobberPrefix: "md-" }}
      components={componentes}
    >
      {blocosDeFormula(texto)}
    </ReactMarkdown>
  );
}
