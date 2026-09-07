import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { ApiError, type ImportResult } from "@mtg/shared";
import { api } from "../lib/api";

const FORMAT_OPTIONS = [
  "Auto-detect",
  "Moxfield",
  "Archidekt",
  "Dragon Shield",
  "Deckbox",
  "ManaBox",
] as const;

const ACCEPTED_EXTENSIONS = [".csv", ".xls", ".xlsx"];

// The API runs on a scale-to-zero Fly machine (min_machines_running=0) that
// autostops ~1 min after the last request. Picking a file takes long enough for
// it to fall asleep, so the upload lands on a cold-starting machine and fails
// with a bare network error before it ever reaches the app. We can't keep the
// machine warm for free, so instead: nudge it awake early, and — because a
// failed request is itself what tells Fly to boot — retry a few times. Import
// is an idempotent "replace collection", so retrying is safe.
const RETRY_DELAYS_MS = [1500, 3000, 4500];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fire-and-forget wake-up so the machine boots while the user picks a file. */
function wakeServer() {
  api.health().catch(() => {});
}

function hasAcceptedExtension(name: string) {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

interface Props {
  visible: boolean;
  /** Whether the user already owns cards — import replaces, so we confirm. */
  hasCollection: boolean;
  onImported: () => void;
  onClose: () => void;
}

export default function ImportCollectionModal({
  visible,
  hasCollection,
  onImported,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Importing…");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [format, setFormat] = useState<string>("Auto-detect");

  // Start waking the (scale-to-zero) API as soon as the sheet opens.
  useEffect(() => {
    if (visible) wakeServer();
  }, [visible]);

  // A fresh open should not show the previous run's outcome.
  useEffect(() => {
    if (visible) {
      setError(null);
      setResult(null);
    }
  }, [visible]);

  const upload = useCallback(
    async (asset: DocumentPicker.DocumentPickerAsset) => {
      setBusy(true);
      setError(null);
      setResult(null);

      // Must be a Blob-like, NOT React Native's `{uri, name, type}` descriptor:
      // Expo swaps in a WinterCG `fetch` whose multipart encoder rejects `uri`
      // parts outright ("Unsupported FormDataPart implementation") — and it
      // fails before anything hits the network, so it looks like the server is
      // down rather than like a client bug. `File` implements Blob and carries
      // its own `name`/`type`, which is what the encoder reads for the part
      // headers. The backend picks its CSV vs Excel parser off that filename.
      const file = new File(asset.uri);
      const fmt = format === "Auto-detect" ? undefined : format;
      const attempts = RETRY_DELAYS_MS.length + 1;

      for (let attempt = 0; attempt < attempts; attempt++) {
        setStatus(attempt === 0 ? "Importing…" : "Server was asleep — retrying…");
        try {
          const res = await api.importCollection(file, asset.name, fmt);
          setResult(res);
          onImported();
          break;
        } catch (e) {
          // Three outcomes, and it matters that we tell them apart:
          //   ApiError      — the server answered and said no (e.g. 400 for an
          //                   unrecognized format). Surface it; retrying is
          //                   pointless.
          //   transport     — the request never reached the app, almost always
          //                   a cold start. Retry after a short backoff.
          //   anything else — a bug on this side (a bad body, a missing
          //                   module). Surface it immediately.
          // The web version treats *everything* non-ApiError as transport. On
          // Expo that is actively misleading: the body is encoded before the
          // request is attempted, so an encoding bug throws a plain Error and
          // would be reported to the user as "couldn't reach the server", which
          // sends everyone hunting a phantom outage. Expo's transport failures
          // are `FetchError`s, whose message is prefixed "fetch failed:".
          const isTransportError =
            !(e instanceof ApiError) &&
            e instanceof Error &&
            e.message.startsWith("fetch failed:");

          if (isTransportError && attempt < attempts - 1) {
            wakeServer();
            await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          setError(
            isTransportError
              ? "Couldn't reach the server (it may have been waking up). Please try again."
              : e instanceof Error
                ? e.message
                : "Import failed",
          );
          break;
        }
      }

      setBusy(false);
    },
    [format, onImported],
  );

  const pickAndImport = useCallback(async () => {
    if (busy) return; // prevent double-submit
    wakeServer();

    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        // Deliberately not a MIME allowlist. iOS maps `type` to UTIs, and CSVs
        // arriving via iCloud Drive, AirDrop or a mail attachment are routinely
        // typed as public.data — a strict filter greys out the user's own file
        // in the picker with no explanation. Accept anything, then check the
        // extension ourselves so the rejection can at least say why.
        type: "*/*",
        // Copies the file into the app's cache, giving a stable file:// URI.
        // Without this the picker can hand back a security-scoped reference
        // that's already been released by the time the upload reads it.
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch {
      setError("Couldn't open the file picker. Please try again.");
      return;
    }

    if (picked.canceled) return;

    const asset = picked.assets?.[0];
    if (!asset) return;

    if (!hasAcceptedExtension(asset.name)) {
      setError(
        `"${asset.name}" isn't a CSV or Excel file. Export your collection from ` +
          "Moxfield, Archidekt, Dragon Shield, Deckbox or ManaBox and pick that file.",
      );
      return;
    }

    if (hasCollection) {
      Alert.alert(
        "Replace collection?",
        "Importing replaces everything currently in your collection. This can't be undone.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Replace", style: "destructive", onPress: () => void upload(asset) },
        ],
      );
      return;
    }

    void upload(asset);
  }, [busy, hasCollection, upload]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      // Always kept in sync with `visible`, even mid-import. A pageSheet can be
      // swiped away and RN gives us no way to block that, so withholding this
      // handler would leave the sheet dismissed on screen but still `visible`
      // in state — and the header button would then refuse to reopen it. The
      // upload finishes either way; only the result summary is lost.
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-slate-950">
        <View className="flex-row items-center justify-between border-b border-slate-800 px-4 py-3">
          <Text className="flex-1 text-lg font-semibold text-white">
            {hasCollection ? "Replace collection" : "Import collection"}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} disabled={busy}>
            <Text className={`text-lg ${busy ? "text-slate-700" : "text-slate-400"}`}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="px-4 py-6">
          <Text className="text-sm leading-5 text-slate-400">
            Pick a CSV or Excel export from Moxfield, Archidekt, Dragon Shield, Deckbox or
            ManaBox. Save it to Files first — from the app's share sheet, iCloud Drive, or a
            mail attachment.
            {hasCollection && " This replaces your current collection."}
          </Text>

          <Text className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-slate-500">
            Format
          </Text>
          {/* Chips rather than a picker: RN has no <select>, and
              @react-native-picker/picker would be another native module to
              autolink for one dropdown. */}
          <View className="flex-row flex-wrap gap-2">
            {FORMAT_OPTIONS.map((f) => {
              const active = f === format;
              return (
                <TouchableOpacity
                  key={f}
                  onPress={() => setFormat(f)}
                  disabled={busy}
                  activeOpacity={0.7}
                  className={`rounded-full border px-3 py-1.5 ${
                    active
                      ? "border-amber-600/60 bg-amber-900/30"
                      : "border-slate-700 bg-slate-900"
                  }`}
                >
                  <Text className={`text-sm ${active ? "text-amber-300" : "text-slate-300"}`}>
                    {f}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            onPress={pickAndImport}
            disabled={busy}
            activeOpacity={0.8}
            className={`mt-6 flex-row items-center justify-center rounded-xl px-4 py-3 ${
              busy ? "bg-emerald-900" : "bg-emerald-700"
            }`}
          >
            {busy && (
              <View className="mr-2">
                <ActivityIndicator size="small" color="#d1fae5" />
              </View>
            )}
            <Text className="text-base font-semibold text-white">
              {busy ? status : "Choose file"}
            </Text>
          </TouchableOpacity>

          {busy && (
            <Text className="mt-3 text-center text-xs text-slate-500">
              Large collections can take a minute. Keep this screen open.
            </Text>
          )}

          {error && <Text className="mt-4 text-sm leading-5 text-rose-400">{error}</Text>}

          {result && (
            <View className="mt-6 rounded-xl border border-emerald-900/60 bg-emerald-950/40 p-4">
              <Text className="text-sm font-semibold text-emerald-300">
                Imported {result.total.toLocaleString()} rows
                {result.detected_format ? ` (${result.detected_format})` : ""}
              </Text>
              <Text className="mt-1 text-sm text-emerald-200/80">
                {result.matched.toLocaleString()} matched ·{" "}
                {result.unmatched.toLocaleString()} unmatched ·{" "}
                {result.unique_owned.toLocaleString()} unique cards
              </Text>
              {result.unmatched_names.length > 0 && (
                <Text className="mt-2 text-xs leading-4 text-emerald-200/60">
                  Not found: {result.unmatched_names.slice(0, 5).join(", ")}
                  {result.unmatched_names.length > 5
                    ? ` +${result.unmatched_names.length - 5} more`
                    : ""}
                </Text>
              )}
              <TouchableOpacity
                onPress={onClose}
                activeOpacity={0.8}
                className="mt-4 items-center rounded-lg border border-emerald-800 py-2"
              >
                <Text className="text-sm font-medium text-emerald-300">Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
