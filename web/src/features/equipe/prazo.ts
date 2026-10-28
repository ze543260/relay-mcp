/**
 * Data curta em pt-BR a partir do prazo ISO; `vencida` se o dia do prazo já passou e a tarefa não está feita.
 * O prazo vem como meia-noite UTC do dia escolhido: formata em UTC para não "voltar um dia" no Brasil.
 */
export function formatarPrazo(iso: string, feita: boolean, agora = Date.now()): { texto: string; vencida: boolean } {
  const data = new Date(iso);
  const texto = data.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });
  const fimDoDia = Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate(), 23, 59, 59, 999);
  return { texto, vencida: !feita && fimDoDia < agora };
}
