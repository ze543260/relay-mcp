import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "cn"

/** `<select>` nativo com o visual do Input: acessível e leve, para listas curtas e fixas (status, prioridade). */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <span data-slot="native-select-wrapper" className={cn("relative inline-flex min-w-0", className)}>
      <select
        data-slot="native-select"
        className="h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-7 pl-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </span>
  )
}

export { NativeSelect }
