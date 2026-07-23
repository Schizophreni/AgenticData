import { CheckIcon, LoaderIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Outcome, stated three ways at once — icon, word, and color — so it never depends
 * on hue alone (accept green vs reject crimson sit close under deuteranopia).
 */
export default function StatusChip({
  status,
  className,
}: {
  status: "in_progress" | "accepted" | "rejected" | string;
  className?: string;
}) {
  const spec =
    status === "accepted"
      ? { Icon: CheckIcon, text: "accepted", color: "text-accept" }
      : status === "rejected"
        ? { Icon: XIcon, text: "rejected", color: "text-reject" }
        : { Icon: LoaderIcon, text: "running", color: "text-muted-foreground" };

  return (
    <span className={cn("flex items-center gap-1", spec.color, className)}>
      <spec.Icon className={cn("size-3", status === "in_progress" && "pulse-run")} />
      <span className="channel-label text-current">{spec.text}</span>
    </span>
  );
}
