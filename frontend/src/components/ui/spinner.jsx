"use client"

import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }) {
  return (
    <Loader2Icon
      className={cn("size-5 animate-spin text-muted-foreground", className)}
      aria-label="Loading"
      {...props} />
  );
}

export { Spinner }

