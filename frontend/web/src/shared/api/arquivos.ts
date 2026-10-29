import { ErroApi } from "./cliente";
import type { Anexo } from "./tipos";

export const ARQUIVO_MAX = 25 * 1024 * 1024;

/** Sobe um arquivo cru (corpo = bytes); a sessão vai no cookie. Com progresso via XHR. */
export function subirArquivo(arquivo: File, aoProgresso?: (fracao: number) => void, sinal?: AbortSignal): Promise<Anexo> {
  return new Promise((ok, falha) => {
    if (arquivo.size > ARQUIVO_MAX) return falha(new ErroApi(413, "arquivo_grande", "Arquivo grande demais (máx. 25 MB).", null));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/arquivos");
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Relay", "1");
    xhr.setRequestHeader("X-Nome", encodeURIComponent(arquivo.name || "arquivo"));
    xhr.setRequestHeader("Content-Type", arquivo.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) aoProgresso?.(e.loaded / e.total); };
    xhr.onload = () => {
      const corpo = (() => { try { return JSON.parse(xhr.responseText) as Record<string, unknown>; } catch { return {}; } })();
      if (xhr.status >= 200 && xhr.status < 300) ok(corpo as unknown as Anexo);
      else falha(new ErroApi(xhr.status, (corpo.codigo as string) ?? null, (corpo.detail as string) ?? null,
        Number(xhr.getResponseHeader("Retry-After")) || null));
    };
    xhr.onerror = () => falha(new TypeError("rede"));
    sinal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(arquivo);
  });
}

export const ehImagem = (tipo: string) => /^image\/(png|jpe?g|gif|webp|avif)$/.test(tipo);

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
