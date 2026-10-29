import type * as React from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

/** Lateral no celular (Sheet). Carregada sob demanda na 1ª abertura. */
export default function SidebarMobile({
  open, onOpenChange, side, dir, largura, children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  side: "left" | "right"
  dir?: string
  largura: string
  children: React.ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        dir={dir}
        data-sidebar="sidebar"
        data-slot="sidebar"
        data-mobile="true"
        className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
        style={{ "--sidebar-width": largura } as React.CSSProperties}
        side={side}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Salas</SheetTitle>
          <SheetDescription>Lista de salas e conta.</SheetDescription>
        </SheetHeader>
        <div className="flex h-full w-full flex-col">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
