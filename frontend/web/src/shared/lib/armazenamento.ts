// localStorage pode lançar (aba privada, site data bloqueado): nunca deixar isso quebrar a UI.
export function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

export function gravar(chave: string, valor: string | null): void {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {
    /* sem armazenamento: segue só em memória */
  }
}

export function lerJson<T>(chave: string, padrao: T): T {
  const bruto = ler(chave);
  if (bruto === null) return padrao;
  try {
    return JSON.parse(bruto) as T;
  } catch {
    return padrao;
  }
}
