import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStore } from "@/store";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useStore();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={toggleTheme}>
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          <span className="sr-only">Switch to {next} bench</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Switch to {next} bench</TooltipContent>
    </Tooltip>
  );
}
