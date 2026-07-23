import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * `tint` paints the range + thumb with a signal color. Used ONLY where the control
 * sets a threshold on the weak/strong score axis, so the control and the plot it
 * governs speak the same color.
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  tint,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { tint?: "weak" | "strong" }) {
  const _values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max]
  );

  const range =
    tint === "weak" ? "bg-weak" : tint === "strong" ? "bg-strong" : "bg-primary";
  const thumb =
    tint === "weak" ? "border-weak" : tint === "strong" ? "border-strong" : "border-primary";

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range data-slot="slider-range" className={cn("absolute h-full", range)} />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className={cn(
            "block size-3.5 shrink-0 rounded-full border-2 bg-card ring-ring/50 transition-[color,box-shadow]",
            "hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none",
            thumb
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
