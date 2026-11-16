import { useState } from "react";
import {
  Modal, View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { isPremiumRequired, type ExternalDeckResponse } from "@mtg/shared";
import { api } from "../lib/api";
import { ColorPips } from "./ManaSymbols";

// Import a deck as a saved deck — the web's "Import deck" (a pasted list or a
// .txt/.csv export) plus a link to an Archidekt or EDHREC deck, which on the
// web lives on the Explore page. Moxfield has no public API to read from, so a
// Moxfield deck comes in as an exported list instead.
//
// Two steps on purpose: resolve first, then save. A pasted list is the one path
// where the source isn't authoritative — typos, custom cards and maybeboards
// are normal — so the preview names what didn't land before anything is written.

const PLACEHOLDER = `1x Ravos, Soultender (c16) 39 *F* [Commander{top}]
1x Animate Dead (plst) EMA-78 [Enchantment]
10x Swamp (khm) 396 [Land]
…or a plain list:
1 Sol Ring
1 Command Tower`;

const TEXT_EXTENSIONS = [".txt", ".csv", ".dec", ".dek"];

type Source = "list" | "link";

/** iOS smart punctuation (and lists copied from Notes or a web page) turn
 *  straight quotes curly — "Praetors’ Voice" — which then match no card name. */
function straightenQuotes(text: string): string {
  return text.replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');
}

/** "my_deck-list.txt" → "my deck list", to seed the deck name. */
function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

export default function ImportDeckModal({
  onSaved,
  onClose,
}: {
  onSaved: (deckId: string) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>("list");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExternalDeckResponse | null>(null);

  async function pickFile() {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      if (!TEXT_EXTENSIONS.some((ext) => asset.name.toLowerCase().endsWith(ext))) {
        setError("Pick a .txt, .csv, .dec or .dek decklist file.");
        return;
      }
      const contents = await new File(asset.uri).text();
      if (!contents.trim()) throw new Error("empty file");
      setText(contents);
      if (!name.trim()) setName(nameFromFile(asset.name));
    } catch {
      setError("Couldn't read that file. Try opening it and pasting the list instead.");
    }
  }

  async function resolve() {
    if (resolving) return;
    setResolving(true);
    setError(null);
    try {
      const res =
        source === "list"
          ? await api.importDeckList({ text: straightenQuotes(text), name: name.trim() || "Imported deck" })
          : await api.fetchExternalDeck({ url: url.trim() });
      setPreview(res);
      if (!name.trim()) setName(res.name);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : source === "list"
            ? "Could not read that decklist"
            : "Could not load that deck",
      );
    } finally {
      setResolving(false);
    }
  }

  async function save() {
    if (!preview || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveDeck(name.trim() || preview.name, preview.deck, {
        source: preview.source,
        ...(preview.source_url ? { source_url: preview.source_url } : {}),
      });
      onSaved(saved.id);
    } catch (e) {
      if (isPremiumRequired(e)) {
        // Close first: the paywall pushed under this sheet would be hidden.
        onClose();
        router.push("/paywall");
        return;
      }
      setError(e instanceof Error ? e.message : "Could not save the deck");
    } finally {
      setSaving(false);
    }
  }

  const canResolve = source === "list" ? !!text.trim() : /^https?:\/\/\S+$/i.test(url.trim());
  const unresolved = preview?.unresolved_names ?? [];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-slate-950">
        <View className="flex-row items-center justify-between border-b border-slate-800 px-4 py-3">
          <TouchableOpacity onPress={onClose} hitSlop={8} activeOpacity={0.6}>
            <Text className="text-sm text-slate-400">Cancel</Text>
          </TouchableOpacity>
          <Text className="text-base font-semibold text-white">Import a deck</Text>
          <View className="w-12" />
        </View>

        <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled" contentContainerClassName="pb-10">
          <Text className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">Deck name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Imported deck"
            placeholderTextColor="#64748b"
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
          />

          {preview ? (
            <View className="mt-4 gap-3">
              <View className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text className="text-sm font-medium text-slate-200">
                    {preview.deck.commander?.name ?? "No commander found"}
                  </Text>
                  {preview.deck.color_identity?.length > 0 && (
                    <ColorPips colors={preview.deck.color_identity} size={14} />
                  )}
                </View>
                <Text className="mt-1 text-sm text-slate-400">
                  {preview.deck.total} cards · <Text className="text-emerald-400">{preview.owned_count} owned</Text>
                  {preview.unowned_count > 0 && <Text className="text-slate-500"> · {preview.unowned_count} unowned</Text>}
                </Text>
                {preview.source_url && preview.owner ? (
                  <Text className="mt-1 text-xs text-slate-500">by {preview.owner}</Text>
                ) : null}
              </View>

              {preview.deck.warnings?.map((w) => (
                <Text key={w} className="text-xs text-amber-400">
                  {w}
                </Text>
              ))}

              {unresolved.length > 0 && (
                <View className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-3">
                  <Text className="text-xs font-medium text-amber-300">
                    {unresolved.length} name(s) didn't match a card and were left out:
                  </Text>
                  <Text className="mt-1 text-xs text-amber-200/80">
                    {unresolved.slice(0, 12).join(", ")}
                    {unresolved.length > 12 ? ` … and ${unresolved.length - 12} more` : ""}
                  </Text>
                </View>
              )}

              {error && <Text className="text-sm text-rose-400">{error}</Text>}

              <View className="flex-row gap-2">
                <TouchableOpacity
                  onPress={save}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-emerald-700 py-3 disabled:opacity-50"
                  activeOpacity={0.8}
                >
                  {saving ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-center text-sm font-semibold text-white">Save to my decks</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setPreview(null);
                    setError(null);
                  }}
                  disabled={saving}
                  className="rounded-lg border border-slate-700 px-4 py-3"
                  activeOpacity={0.7}
                >
                  <Text className="text-sm text-slate-300">Back</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View className="mt-4 gap-3">
              <View className="flex-row rounded-lg border border-slate-700 p-0.5">
                {(["list", "link"] as const).map((s) => (
                  <TouchableOpacity
                    key={s}
                    onPress={() => {
                      setSource(s);
                      setError(null);
                    }}
                    className={"flex-1 rounded-md py-2 " + (source === s ? "bg-slate-800" : "")}
                    activeOpacity={0.7}
                  >
                    <Text className={"text-center text-sm " + (source === s ? "text-white" : "text-slate-400")}>
                      {s === "list" ? "Paste a list" : "From a link"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {source === "list" ? (
                <>
                  <Text className="text-xs leading-4 text-slate-500">
                    Paste a decklist, or choose a .txt/.csv export from Moxfield, Archidekt, Arena or MTGO.
                  </Text>
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    placeholder={PLACEHOLDER}
                    placeholderTextColor="#475569"
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    textAlignVertical="top"
                    style={{ minHeight: 200, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs text-slate-200"
                  />
                  <TouchableOpacity onPress={pickFile} className="self-start rounded-lg border border-slate-700 px-3 py-2" activeOpacity={0.7}>
                    <Text className="text-sm text-slate-300">Choose file…</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text className="text-xs leading-4 text-slate-500">
                    Paste a link to a public deck on Archidekt or EDHREC. For a Moxfield deck, export it there
                    and paste the list instead.
                  </Text>
                  <TextInput
                    value={url}
                    onChangeText={setUrl}
                    placeholder="https://archidekt.com/decks/…"
                    placeholderTextColor="#475569"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-slate-200"
                  />
                </>
              )}

              {error && <Text className="text-sm text-rose-400">{error}</Text>}

              <TouchableOpacity
                onPress={resolve}
                disabled={resolving || !canResolve}
                className="rounded-lg bg-indigo-600 py-3 disabled:opacity-50"
                activeOpacity={0.8}
              >
                {resolving ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-center text-sm font-semibold text-white">Continue</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
