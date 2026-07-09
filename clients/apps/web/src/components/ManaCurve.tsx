import type { CurveBucket } from "@mtg/shared";

// Hand-built bar chart (Tailwind + divs, no chart library) — nonland pool cards by mana value.
export default function ManaCurve({ curve }: { curve: CurveBucket[] }) {
  const max = Math.max(1, ...curve.map((b) => b.count));
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
        Mana curve (nonlands)
      </div>
      <div className="mt-4 flex items-end gap-2" style={{ height: 160 }}>
        {curve.map((b) => (
          <div key={b.cmc} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs tabular-nums text-slate-400">{b.count}</span>
            <div
              className="w-full rounded-t bg-emerald-500/80"
              style={{ height: `${(b.count / max) * 120}px`, minHeight: b.count ? 2 : 0 }}
              title={`MV ${b.cmc === 7 ? "7+" : b.cmc}: ${b.count}`}
            />
            <span className="text-xs text-slate-500">{b.cmc === 7 ? "7+" : b.cmc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
