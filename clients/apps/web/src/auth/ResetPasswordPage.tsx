import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { api } from "../lib/api";
import Logo from "../components/Logo";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
        <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-xl text-center">
          <p className="text-sm text-rose-400">Invalid reset link. No token provided.</p>
          <p className="mt-4 text-sm text-slate-400">
            <Link to="/forgot-password" className="text-emerald-400 hover:underline">
              Request a new reset link
            </Link>
          </p>
        </div>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.resetPassword(token, password);
      setUser(await api.me());
      navigate("/", { replace: true });
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
        <p className="mt-2 text-sm text-slate-400">Choose a new password</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-300">New password</span>
            <input
              required
              type="password"
              value={password}
              autoComplete="new-password"
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
            />
            <span className="mt-1 block text-xs text-slate-500">At least 8 characters.</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-300">Confirm password</span>
            <input
              required
              type="password"
              value={confirm}
              autoComplete="new-password"
              minLength={8}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
            />
          </label>

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? "Resetting…" : "Set new password"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          <Link to="/login" className="text-emerald-400 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
