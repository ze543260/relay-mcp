import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-md bg-muted bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--foreground)_6%,transparent),transparent)] bg-[length:200%_100%] motion-safe:animate-[brilho_1.4s_linear_infinite]", className)}
      {...props}
    />
  )
}

export { Skeleton }
