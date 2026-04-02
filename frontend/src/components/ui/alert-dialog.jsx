"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function AlertDialog({
  ...props
}) {
  return <DialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogPortal({
  ...props
}) {
  return <DialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-slate-950/30 duration-100 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props} />
  );
}

function AlertDialogContent({
  className,
  children,
  ...props
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <DialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-0 overflow-hidden rounded-[28px] border border-white/70 bg-background text-sm shadow-[0_32px_90px_-40px_rgba(24,36,33,0.58)] outline-none duration-100 sm:max-w-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}>
        {children}
      </DialogPrimitive.Popup>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({
  className,
  ...props
}) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props} />
  );
}

function AlertDialogFooter({
  className,
  ...props
}) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-border/70 bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props} />
  );
}

function AlertDialogTitle({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-xl font-semibold tracking-tight text-slate-950", className)}
      {...props} />
  );
}

function AlertDialogDescription({
  className,
  ...props
}) {
  return (
    <DialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm leading-6 text-slate-600", className)}
      {...props} />
  );
}

function AlertDialogCancel({
  className,
  children,
  ...props
}) {
  return (
    <DialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      render={<Button variant="outline" className={className} />}
      {...props}>
      {children}
    </DialogPrimitive.Close>
  );
}

const alertDialogActionVariants = {
  default:
    "bg-primary text-primary-foreground shadow-[0_18px_32px_-18px_rgba(20,95,89,0.78)] hover:bg-primary/92 hover:-translate-y-0.5",
  destructive:
    "border border-transparent bg-[#9f3d1f] text-white shadow-[0_20px_36px_-18px_rgba(159,61,31,0.7)] hover:bg-[#8f361b] hover:-translate-y-0.5",
}

function AlertDialogAction({
  className,
  variant = "default",
  ...props
}) {
  return (
    <Button
      className={cn(alertDialogActionVariants[variant] || alertDialogActionVariants.default, className)}
      {...props} />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
}
