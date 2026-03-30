import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-[28px] border border-white/70 bg-card/90 shadow-[0_26px_60px_-34px_rgba(24,36,33,0.34)] backdrop-blur-sm ring-1 ring-border/70",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 border-b border-border/70 px-6 py-5", className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }) {
  return (
    <h3
      data-slot="card-title"
      className={cn("text-base font-semibold leading-none tracking-tight text-foreground", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }) {
  return (
    <div data-slot="card-content" className={cn("px-6 py-5", className)} {...props} />
  )
}

function CardFooter({ className, ...props }) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center justify-end gap-2 border-t border-border/70 px-6 py-5", className)}
      {...props}
    />
  )
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
