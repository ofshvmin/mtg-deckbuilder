import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

const PERKS = [
  "Unlimited saved decks",
  "AI deck brief — describe a deck in plain English",
];

interface PremiumUpgradeState {
  /** Open the upgrade prompt. Pass the feature that was gated, if known. */
  showUpgrade: (feature?: string) => void;
}

const Ctx = createContext<PremiumUpgradeState | null>(null);

export function usePremiumUpgrade(): PremiumUpgradeState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePremiumUpgrade must be used within a PremiumUpgradeProvider");
  return ctx;
}

export function PremiumUpgradeProvider({ children }: { children: ReactNode }) {
  const [feature, setFeature] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const showUpgrade = useCallback((f?: string) => {
    setFeature(f ?? null);
    setOpen(true);
  }, []);

  const close = () => setOpen(false);

  return (
    <Ctx.Provider value={{ showUpgrade }}>
      {children}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-2xl font-bold text-amber-300">Grimoire Premium ✦</div>
            <p className="mt-2 text-sm text-slate-300">
              {feature ? (
                <>
                  <span className="text-slate-100">{feature}</span> is a Premium feature.
                </>
              ) : (
                "That's a Premium feature."
              )}
            </p>

            <ul className="mt-4 space-y-2">
              {PERKS.map((perk) => (
                <li key={perk} className="flex items-start gap-2 text-sm text-slate-200">
                  <span className="text-amber-400">✦</span>
                  <span>{perk}</span>
                </li>
              ))}
            </ul>

            <div className="mt-5 rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
              Premium is purchased in the <span className="font-semibold text-slate-100">Grimoire iOS app</span>.
              Once you upgrade there, your Premium features unlock here automatically with the same account.
            </div>

            <button
              onClick={close}
              className="mt-5 w-full rounded-lg bg-slate-800 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-slate-700"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
