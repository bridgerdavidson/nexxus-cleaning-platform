// src/components/redesign/calendar/NowIndicator.tsx
/** Brand-blue "now" line + dot across a time-grid column. `y` is the pixel offset from nowLineY(). */
export function NowIndicator({ y }: { y: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: y }} aria-hidden>
      <div className="relative h-0.5 bg-brand-600">
        <span className="absolute -left-1 -top-[3px] size-2 rounded-full bg-brand-600" />
      </div>
    </div>
  );
}
