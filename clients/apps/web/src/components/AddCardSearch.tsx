import { useEffect, useMemo, useRef, useState } from "react";
import type { CardSearchResult } from "@mtg/shared";
import { api } from "../lib/api";
import { fetchPrintings, type PrintOption } from "../lib/scryfallPrints";
import { lookupSet, useScryfallSets } from "../lib/scryfallSets";
import SetSymbol from "./SetSymbol";

const CONDITIONS = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"];
const FINISH_LABEL: Record<string, string> = { nonfoil: "Nonfoil", foil: "Foil", etched: "Etched" };

function year(iso: string): string {
  return iso ? iso.slice(0, 4) : "";
}

export default function AddCardSearch({
  onAdded,
  onClose,
}: {
  onAdded: () => void;
  onClose: () => void;
}) {
  const sets = useScryfallSets();

  // Step 1: card search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Step 2: chosen card + printing + details
  const [card, setCard] = useState<CardSearchResult | null>(null);
  const [prints, setPrints] = useState<PrintOption[] | null>(null);
  const [loadingPrints, setLoadingPrints] = useState(false);
  const [printFilter, setPrintFilter] = useState("");
  const [print, setPrint] = useState<PrintOption | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [finish, setFinish] = useState("nonfoil");
  const [condition, setCondition] = useState(CONDITIONS[0]);
  const [price, setPrice] = useState("");

  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedMsg, setAddedMsg] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced name search (only in step 1).
  useEffect(() => {
    if (card) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await api.searchCards(query.trim(), 15));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, card]);

  async function selectCard(c: CardSearchResult) {
    setCard(c);
    setResults([]);
    setPrints(null);
    setPrint(null);
    setPrintFilter("");
    setAddedMsg(null);
    setError(null);
    setLoadingPrints(true);
    try {
      const p = await fetchPrintings(c.oracle_id);
      setPrints(p);
      if (p.length > 0) choosePrint(p[0]);
    } finally {
      setLoadingPrints(false);
    }
  }

  function choosePrint(p: PrintOption) {
    setPrint(p);
    const f = p.finishes.includes("nonfoil") ? "nonfoil" : p.finishes[0];
    setFinish(f);
    setPrice(f === "foil" && p.priceUsdFoil != null ? String(p.priceUsdFoil) : p.priceUsd != null ? String(p.priceUsd) : "");
  }

  function reset() {
    setCard(null);
    setPrints(null);
    setPrint(null);
    setQuery("");
    setResults([]);
    inputRef.current?.focus();
  }

  const filteredPrints = useMemo(() => {
    if (!prints) return [];
    const f = printFilter.trim().toLowerCase();
    return f ? prints.filter((p) => p.setName.toLowerCase().includes(f) || p.set.includes(f)) : prints;
  }, [prints, printFilter]);

  async function add() {
    if (!card) return;
    setAdding(true);
    setError(null);
    try {
      await api.addCard({
        name: card.name,
        oracleId: card.oracle_id,
        count: quantity,
        edition: print?.set ?? null,
        collectorNumber: print?.collectorNumber ?? null,
        finish,
        condition,
        purchasePrice: price.trim() ? Number(price) : null,
        language: "en",
      });
      onAdded();
      setAddedMsg(
        `Added ${quantity}× ${card.name}${print ? ` (${print.set.toUpperCase()})` : ""}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add card");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-200">Add card to collection</h3>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">✕</button>
      </div>

      {/* Step 1: card search */}
      {!card && (
        <>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a card…"
            className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
          />
          {searching && <p className="mt-2 text-xs text-slate-500">Searching…</p>}
          {addedMsg && <p className="mt-2 text-sm text-emerald-400">{addedMsg}</p>}
          {results.length > 0 && (
            <ul className="mt-2 max-h-64 divide-y divide-slate-800/60 overflow-y-auto rounded-lg border border-slate-800">
              {results.map((c) => (
                <li key={c.oracle_id}>
                  <button
                    onClick={() => selectCard(c)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-800/50"
                  >
                    <span className="text-slate-200">{c.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{c.type_line}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Step 2: printing + details */}
      {card && (
        <div className="mt-3 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-slate-100">{card.name}</div>
            <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-300">
              ← Change card
            </button>
          </div>

          {/* Printing picker */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wider text-slate-500">Set / printing</label>
              {prints && prints.length > 8 && (
                <input
                  value={printFilter}
                  onChange={(e) => setPrintFilter(e.target.value)}
                  placeholder="Filter sets…"
                  className="w-40 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-500"
                />
              )}
            </div>
            {loadingPrints ? (
              <p className="mt-2 text-xs text-slate-500">Loading printings…</p>
            ) : prints && prints.length > 0 ? (
              <ul className="mt-2 max-h-56 divide-y divide-slate-800/60 overflow-y-auto rounded-lg border border-slate-800">
                {filteredPrints.map((p) => {
                  const active = print?.set === p.set && print?.collectorNumber === p.collectorNumber;
                  const info = lookupSet(sets, p.set);
                  return (
                    <li key={`${p.set}-${p.collectorNumber}`}>
                      <button
                        onClick={() => choosePrint(p)}
                        className={
                          "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition " +
                          (active ? "bg-emerald-600/10" : "hover:bg-slate-800/50")
                        }
                      >
                        <SetSymbol iconUri={info?.iconSvgUri} code={p.set} className="h-7 w-7 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className={active ? "text-emerald-300" : "text-slate-200"}>{p.setName}</span>
                          <span className="ml-2 text-xs text-slate-500">
                            #{p.collectorNumber}
                            {year(p.releasedAt) ? ` · ${year(p.releasedAt)}` : ""}
                          </span>
                        </span>
                        {p.priceUsd != null && (
                          <span className="shrink-0 text-xs tabular-nums text-slate-500">${p.priceUsd.toFixed(2)}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-amber-400">
                No printings found on Scryfall — the card will be added without a specific set.
              </p>
            )}
          </div>

          {/* Detail fields */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Quantity">
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-200"
              />
            </Field>
            <Field label="Finish">
              <select
                value={finish}
                onChange={(e) => setFinish(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-200"
              >
                {(print?.finishes ?? ["nonfoil", "foil"]).map((f) => (
                  <option key={f} value={f}>{FINISH_LABEL[f] ?? f}</option>
                ))}
              </select>
            </Field>
            <Field label="Condition">
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-200"
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Purchase price">
              <div className="flex items-center rounded-md border border-slate-700 bg-slate-800 px-2">
                <span className="text-sm text-slate-500">$</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-transparent px-1 py-1.5 text-sm text-slate-200 outline-none placeholder:text-slate-600"
                />
              </div>
            </Field>
          </div>

          {error && <p className="text-sm text-rose-400">{error}</p>}
          {addedMsg && <p className="text-sm text-emerald-400">{addedMsg}</p>}

          <div className="flex items-center gap-3">
            <button
              onClick={add}
              disabled={adding}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add to collection"}
            </button>
            <button onClick={reset} className="text-sm text-slate-400 hover:text-slate-200">
              Add another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}
