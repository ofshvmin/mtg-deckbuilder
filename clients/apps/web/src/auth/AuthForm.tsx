import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import Logo from "../components/Logo";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const isRegister = mode === "register";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isRegister) await register(email, password);
      else await login(email, password);
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
        <p className="mt-2 text-sm text-slate-400">
          {isRegister ? "Create your account" : "Sign in to your account"}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={isRegister ? "new-password" : "current-password"}
            hint={isRegister ? "At least 8 characters." : undefined}
          />

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
          </button>

          {!isRegister && (
            <p className="text-center text-sm">
              <Link to="/forgot-password" className="text-slate-400 hover:text-emerald-400 hover:underline">
                Forgot your password?
              </Link>
            </p>
          )}
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          {isRegister ? (
            <>
              Already have an account?{" "}
              <Link to="/login" className="text-emerald-400 hover:underline">
                Sign in
              </Link>
            </>
          ) : (
            <>
              Need an account?{" "}
              <Link to="/register" className="text-emerald-400 hover:underline">
                Create one
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-300">{props.label}</span>
      <input
        required
        type={props.type}
        value={props.value}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
      />
      {props.hint && <span className="mt-1 block text-xs text-slate-500">{props.hint}</span>}
    </label>
  );
}
