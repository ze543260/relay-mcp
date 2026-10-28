import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Markdown from "./Markdown";

const renderizar = (texto: string) => render(<Markdown texto={texto} />).container;

describe("Markdown", () => {
  it("renderiza GFM (tabela, negrito, código)", () => {
    const c = renderizar("| a | b |\n|---|---|\n| **x** | `y` |");
    expect(c.querySelector("table")).not.toBeNull();
    expect(c.querySelector("strong")?.textContent).toBe("x");
    expect(c.querySelector("code")?.textContent).toBe("y");
  });

  it("remove HTML perigoso", () => {
    const c = renderizar('<img src=x onerror="alert(1)"><script>alert(1)</script> oi');
    expect(c.querySelector("img")).toBeNull();
    expect(c.querySelector("script")).toBeNull();
    expect(c.innerHTML).not.toContain("onerror");
  });

  it("neutraliza links javascript: e abre os normais em nova aba", () => {
    const c = renderizar("[ruim](javascript:alert(1)) [bom](https://example.com)");
    const [ruim, bom] = Array.from(c.querySelectorAll("a"));
    expect(ruim?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
    expect(bom).toHaveAttribute("href", "https://example.com");
    expect(bom).toHaveAttribute("target", "_blank");
    expect(bom).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renderiza LaTeX inline e em bloco (mesmo com $$ numa linha só)", () => {
    const c = renderizar("custo $O(n)$ e `snake_case`\n\n$$\\sum_i x_i$$");
    expect(c.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(c.querySelector(".katex-display")).not.toBeNull();
    expect(c.querySelector("code")?.textContent).toBe("snake_case");
  });
});
