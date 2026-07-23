import { Hash } from "lucide-react";
import type { ReactNode } from "react";

import { Separator } from "@/components/ui/separator";

/** Discord's channel bar: # name, a vertical rule, the topic, then actions on the right. */
export default function ChannelHeader({
  name,
  topic,
  actions,
}: {
  name: string;
  topic?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 shadow-sm">
      <Hash className="size-5 shrink-0 text-muted-foreground" />
      <h1 className="shrink-0 text-base font-semibold text-heading">{name}</h1>
      {topic && (
        <>
          <Separator orientation="vertical" className="mx-2 h-6" />
          <div className="truncate text-sm text-muted-foreground">{topic}</div>
        </>
      )}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
