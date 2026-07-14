import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import Logo from "../components/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.forgotPassword(email);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl">
        <div className="flex items-center gap-2.5">
          <Logo className="h-8 w-8 text-[#d8b25c]" />
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Grimoire</h1>
        </div>

        {submitted ? (
          <>
            <p className="mt-4 text-sm text-slate-300">
              If an account exists for <span className="font-medium text-slate-100">{email}</span>,
              we've sent a password reset link. Check your inbox.
            </p>
            <p className="mt-6 text-center text-sm text-slate-400">
              <Link to="/login" className="text-emerald-400 hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-400">
              Enter your email and we'll send you a link to reset your password.
            </p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-300">Email</span>
                <input
                  required
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
                />
              </label>

              {error && <p className="text-sm text-rose-400">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send reset link"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-slate-400">
              <Link to="/login" className="text-emerald-400 hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
