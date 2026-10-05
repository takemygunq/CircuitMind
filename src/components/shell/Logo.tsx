/* eslint-disable @next/next/no-img-element */
/** Знак CircuitMind (оранжевая молния-схема, сгенерирована в Higgsfield) + словесный знак живым текстом. */
export function Logo({ word = false, size = 28 }: { word?: boolean; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <img src="/brand/mark.svg" alt="" width={size} height={size} className="shrink-0" />
      {word && <span className="text-[17px] font-semibold tracking-tight">CircuitMind</span>}
    </span>
  );
}
