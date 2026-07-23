import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A Discord embed: a rounded panel with a 4px colored bar down its left edge.
 * That bar is the reason this shell fits — an embed's accent already means
 * "the status of the thing inside", which is exactly what accept/reject is.
 */
export default function Embed({
  accent = "none",
  className,
  children,
}: {
  accent?: "accept" | "reject" | "idle" | "none";
  className?: string;
  children: ReactNode;
}) {
  const bar =
    accent === "accept"
      ? "bg-accept"
      : accent === "reject"
        ? "bg-reject"
        : accent === "idle"
          ? "bg-idle"
          : "bg-border";

  return (
    <div className={cn("flex overflow-hidden rounded-lg bg-elevated", className)}>
      <span className={cn("w-1 shrink-0", bar)} aria-hidden />
      <div className="min-w-0 flex-1 p-3">{children}</div>
    </div>
  );
}
