import "katex/dist/katex.min.css";
import "./realce.css";
import ReactMarkdown, { type Components } from "react-markdown";
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
    span: [...(defaultSchema.attributes?.span ?? []), ["className", "math", "math-inline", "math-display"]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", "math", "math-display"]],
  },
};

// Agentes escrevem `$$x$$` numa linha só; o remark-math só trata como bloco se cercado por linhas.
const blocosDeFormula = (texto: string): string =>
  texto.replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, tex: string) => `$$\n${tex}\n$$`);

const componentes: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

export default function Markdown({ texto }: { texto: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
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
