import { ActionSheetIOS, Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

// Exports, the phone way: the web downloads a CSV, the app writes it to the
// cache directory and hands it to the share sheet — Files, Mail, AirDrop, or
// straight into the Moxfield app.

/** The formats the backend can write, the same list the web offers. */
export const EXPORT_FORMATS = ["Moxfield", "Archidekt", "Dragon Shield", "Deckbox", "ManaBox"] as const;

/** Ask which format; resolves null if cancelled. Android just takes the default. */
export function pickExportFormat(title: string): Promise<string | null> {
  if (Platform.OS !== "ios") return Promise.resolve(EXPORT_FORMATS[0]);
  return new Promise((resolve) => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...EXPORT_FORMATS, "Cancel"], cancelButtonIndex: EXPORT_FORMATS.length },
      (i) => resolve(i < EXPORT_FORMATS.length ? EXPORT_FORMATS[i] : null),
    );
  });
}

/** "My Deck!" + "Dragon Shield" → "my-deck-dragon-shield.csv" */
export function exportFilename(base: string, format: string): string {
  const slug = `${base}-${format}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "export"}.csv`;
}

/** Write CSV text to a cache file and open the share sheet on it. */
export async function shareCsv(csv: string, filename: string): Promise<void> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.write(csv);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/csv",
    UTI: "public.comma-separated-values-text",
    dialogTitle: filename,
  });
}
