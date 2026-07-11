import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const current = user?.preferences?.max_card_price;
  const [value, setValue] = useState<string>(current != null ? String(current) : "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const trimmed = value.trim();
      const max_card_price = trimmed === "" ? null : Number(trimmed);
      if (max_card_price != null && (Number.isNaN(max_card_price) || max_card_price < 0)) {
        setError("Enter a non-negative dollar amount, or leave blank for no cap.");
        return;
      }
      const updated = await api.updatePreferences({ max_card_price });
      setUser(updated);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save preferences.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="mt-1 text-sm text-slate-400">Signed in as {user?.email}</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h3 className="text-sm font-medium text-slate-200">Recommendation budget</h3>
        <p className="mt-1 text-sm text-slate-400">
          Maximum price you'll pay for a recommended card you don't own. Cards above this
          are hidden from <span className="text-fuchsia-300">Combo finishers</span> and{" "}
          <span className="text-emerald-300">Budget upgrades</span>. Leave blank for no cap.
          (Owned cards are always shown.)
        </p>

        <div className="mt-4 flex items-center gap-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
            <input
              type="number"
              min="0"
              step="0.5"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSaved(false);
              }}
              placeholder="no cap"
              className="w-40 rounded-lg border border-slate-700 bg-slate-800 py-2 pl-7 pr-3 text-sm text-slate-200 placeholder:text-slate-500"
            />
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-sm text-emerald-400">Saved</span>}
        </div>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      </div>
    </div>
  );
}
