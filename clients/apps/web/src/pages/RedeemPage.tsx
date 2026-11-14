import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import Logo from "../components/Logo";

// Where a promo card's QR code lands: /redeem?code=XXXX-XXXX.
//
// Public on purpose — most people scanning a card don't have an account yet. The
// code is parked in sessionStorage so it survives the detour through sign-up,
// and redeeming is an explicit button rather than automatic, so a code is never
// spent on whichever account happened to be signed in on a shared browser.
//
// Web only: App Store rules bar redeeming our own codes inside the iOS app. The
// grant is account-wide, so the app picks it up on its own.

const STORAGE_KEY = "grimoire.promoCode";
const NEXT = encodeURIComponent("/redeem");

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function RedeemPage() {
  const { user, loading, setUser } = useAuth();
  const [params] = useSearchParams();
  const [code, setCode] = useState(() => params.get("code") ?? sessionStorage.getItem(STORAGE_KEY) ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [premiumUntil, setPremiumUntil] = useState<string | null>(null);

  useEffect(() => {
    if (code.trim()) sessionStorage.setItem(STORAGE_KEY, code.trim());
  }, [code]);

  async function redeem(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.redeemPromo(code);
      sessionStorage.removeItem(STORAGE_KEY);
      setPremiumUntil(res.premium_until);
      setUser(await api.me());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't redeem that code.");
    } finally {
      setSubmitting(false);
    }
  }

  let body;
  if (loading) {
    body = <p className="mt-6 text-sm text-slate-400">Loading…</p>;
  } else if (premiumUntil) {
    body = (
      <div className="mt-6 space-y-4">
        <p className="text-lg font-medium text-emerald-300">Premium unlocked ✦</p>
        <p className="text-sm text-slate-300">
          Your account has Grimoire Premium until <strong>{formatDate(premiumUntil)}</strong> — unlimited
          saved decks and AI deck briefs. Sign in to the Grimoire iOS app with the same account and
          it&rsquo;s there too.
        </p>
        <Link
          to="/"
          className="block w-full rounded-lg bg-emerald-600 px-4 py-2 text-center font-medium text-white transition hover:bg-emerald-500"
        >
          Start building
        </Link>
      </div>
    );
  } else if (!user) {
    body = (
      <div className="mt-6 space-y-4">
        {code && (
          <p className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-center font-mono tracking-widest text-slate-200">
            {code.toUpperCase()}
          </p>
        )}
        <p className="text-sm text-slate-400">
          Create a free account (or sign in) to claim your Premium. Your code is saved while you do.
        </p>
        <Link
          to={`/register?next=${NEXT}`}
          className="block w-full rounded-lg bg-emerald-600 px-4 py-2 text-center font-medium text-white transition hover:bg-emerald-500"
        >
          Create account
        </Link>
        <Link
          to={`/login?next=${NEXT}`}
          className="block w-full rounded-lg border border-slate-700 px-4 py-2 text-center text-slate-200 transition hover:bg-slate-800"
        >
          I already have an account
        </Link>
      </div>
    );
  } else {
    body = (
      <form onSubmit={redeem} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-300">Promo code</span>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-center font-mono uppercase tracking-widest text-slate-100 outline-none focus:border-emerald-500"
          />
        </label>
        <p className="text-xs text-slate-500">Redeeming for {user.email}</p>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !code.trim()}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {submitting ? "Redeeming…" : "Claim Premium"}
        </button>
        <p className="text-center text-sm">
          <Link to="/" className="text-slate-400 hover:text-emerald-400 hover:underline">
            Not now — go to Grimoire
          </Link>
        </p>
      </form>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
        <div className="flex items-center gap-2.5">
          <Logo className="h-8 w-8 text-[#d8b25c]" />
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Grimoire</h1>
        </div>
        <p className="mt-2 text-sm text-slate-400">Claim your free Grimoire Premium</p>
        {body}
      </div>
    </div>
  );
}
