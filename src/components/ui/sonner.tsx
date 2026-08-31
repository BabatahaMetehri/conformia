"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme, theme } = useTheme();
  // `useTheme()` peut rendre `undefined` avant l'hydratation. On retombe sur
  // "system" plutot que de propager `undefined` : avec exactOptionalPropertyTypes,
  // une prop absente et une prop a `undefined` ne sont pas la meme chose.
  const activeTheme: ToasterProps["theme"] =
    theme === "light" || theme === "dark" || theme === "system"
      ? theme
      : resolvedTheme === "dark"
        ? "dark"
        : "system";

  return (
    <Sonner
      theme={activeTheme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
