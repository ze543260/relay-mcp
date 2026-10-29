import { HashIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { normalizarNome } from "@/shared/lib/formato";
import { textos } from "@/shared/lib/textos";
import { useSalas } from "./useSalas";

interface Props {
  aberta: boolean;
  setAberta: (a: boolean) => void;
  salaAtual: string;
  aoEscolher: (sala: string) => void;
}

const t = textos.paleta;

/** Ctrl/Cmd+K: busca salas existentes ou entra numa nova pelo nome digitado. */
export function PaletaSalas({ aberta, setAberta, salaAtual, aoEscolher }: Props) {
  const { data = [] } = useSalas();
  const [busca, setBusca] = useState("");
  const nova = normalizarNome(busca);
  const existe = data.some((s) => s.sala === nova);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setAberta(!aberta);
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberta, setAberta]);

  const ir = (sala: string) => {
    setAberta(false);
    setBusca("");
    aoEscolher(sala);
  };

  return (
    <CommandDialog open={aberta} onOpenChange={setAberta} title={t.titulo} description={t.descricao}>
      <CommandInput value={busca} onValueChange={setBusca} placeholder={t.placeholder} />
      <CommandList>
        <CommandEmpty>{t.vazio}</CommandEmpty>
        <CommandGroup heading={t.grupoSalas}>
          {data.map((s) => (
            <CommandItem key={s.sala} value={s.sala} onSelect={() => ir(s.sala)} keywords={s.agentes}>
              <HashIcon />
              <span className="truncate">{s.sala}</span>
              {s.sala === salaAtual
                ? <CommandShortcut>atual</CommandShortcut>
                : <CommandShortcut>{s.total}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
        {nova && !existe && (
          <CommandGroup heading={t.grupoCriar} forceMount>
            <CommandItem value={`__nova__${nova}`} onSelect={() => ir(nova)} forceMount>
              <PlusIcon />
              {t.criar(nova)}
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
