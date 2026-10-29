import { AvatarImage } from "@/components/ui/avatar";
import { useAgentes } from "@/features/agentes/useAgentes";

/** URL versionada: a foto é imutável por versão, então o navegador cacheia de vez. */
export const urlFoto = (nome: string, versao: number) => `/agentes/${encodeURIComponent(nome)}/foto?v=${versao}`;

/** Foto de perfil dentro de um <Avatar>; sem foto (ou enquanto carrega), o AvatarFallback com as iniciais aparece. */
export function FotoPerfil({ nome, className }: { nome: string; className?: string }) {
  const { data } = useAgentes();
  const versao = data?.find((a) => a.nome === nome)?.foto;
  if (!versao) return null;
  return <AvatarImage src={urlFoto(nome, versao)} alt="" loading="lazy" decoding="async" className={className} />;
}
