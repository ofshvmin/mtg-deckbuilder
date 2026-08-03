import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Alert } from "react-native";
import { router } from "expo-router";
import type { CollectionSummary, SavedDeckSummary } from "@mtg/shared";
import { DATA_SOURCE_NOTICE, FAN_CONTENT_NOTICE } from "@mtg/shared";
import { api } from "../../src/lib/api";
import { useAuth } from "../../src/auth/AuthContext";
import { CommanderArtImage } from "../../src/components/CardImage";

export default function HomeScreen() {
  const { user, logout, deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [recent, setRecent] = useState<SavedDeckSummary[]>([]);
  const [deckCount, setDeckCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.collectionSummary().then(setSummary).catch(() => null),
      api.listSavedDecks()
        .then((d) => {
          setDeckCount(d.length);
          setRecent([...d].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 4));
        })
        .catch(() => []),
    ]).finally(() => setLoading(false));
  }, []);

  const greeting = user?.email?.split("@")[0] ?? "there";

  const confirmDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This permanently deletes your account, your entire collection, and all saved decks. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: () => {
            // Second confirmation — this action is irreversible.
            Alert.alert(
              "Are you absolutely sure?",
              "There is no way to recover your account or data after this.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Permanently Delete",
                  style: "destructive",
                  onPress: async () => {
                    setDeleting(true);
                    try {
                      await deleteAccount();
                      // Signing out clears the user; the app returns to the
                      // auth screen automatically.
                    } catch {
                      setDeleting(false);
                      Alert.alert(
                        "Couldn't delete account",
                        "Something went wrong. Please check your connection and try again.",
                      );
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  return (
    <ScrollView className="flex-1 bg-slate-950 px-4 py-6">
      <Text className="text-2xl font-bold text-slate-100">Welcome back, {greeting}</Text>
      <Text className="mt-1 text-sm text-slate-400">Pick up where you left off.</Text>

      {loading ? (
        <ActivityIndicator size="large" color="#d8b25c" className="mt-10" />
      ) : (
        <View className="mt-6 gap-6">
          {/* Stats */}
          <View className="flex-row gap-3">
            <StatCard label="Cards" value={summary?.total_cards ?? 0} />
            <StatCard label="Unique" value={summary?.unique_cards ?? 0} />
            <StatCard label="Decks" value={deckCount} />
          </View>

          {/* Quick actions */}
          <View className="gap-3">
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/build")}
              className="rounded-xl border border-emerald-700/50 bg-emerald-900/20 p-4"
              activeOpacity={0.7}
            >
              <Text className="text-base font-semibold text-emerald-300">Build a deck →</Text>
              <Text className="mt-0.5 text-sm text-slate-400">Auto-build or describe what you want</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/collection")}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
              activeOpacity={0.7}
            >
              <Text className="text-base font-semibold text-slate-100">Browse collection →</Text>
              <Text className="mt-0.5 text-sm text-slate-400">View and manage your cards</Text>
            </TouchableOpacity>
          </View>

          {/* Recent decks */}
          {recent.length > 0 && (
            <View>
              <Text className="mb-3 text-lg font-semibold text-slate-100">Recent decks</Text>
              <View className="gap-3">
                {recent.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    onPress={() => router.push({ pathname: "/(tabs)/decks", params: { open: d.id } })}
                    activeOpacity={0.7}
                    className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60"
                  >
                    <View style={{ height: 80 }}>
                      <CommanderArtImage
                        name={d.commander_name}
                        artCropUrl={d.commander_art_crop}
                        artist={d.commander_artist}
                        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                      />
                      <View
                        style={{
                          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                          backgroundColor: "rgba(2,6,23,0.6)",
                        }}
                      />
                      <View className="absolute bottom-0 left-0 right-0 p-2.5">
                        <Text className="text-sm font-semibold text-white" numberOfLines={1}>
                          {d.name}
                        </Text>
                        <Text className="text-xs text-slate-400">
                          {d.commander_name} · {d.color_identity.join("") || "C"}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Account actions */}
          <View className="gap-3">
            <TouchableOpacity
              onPress={logout}
              className="rounded-lg border border-slate-700 py-3"
              activeOpacity={0.7}
            >
              <Text className="text-center text-sm text-slate-400">Sign Out</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={confirmDeleteAccount}
              disabled={deleting}
              className="rounded-lg border border-red-900/60 py-3"
              activeOpacity={0.7}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#f87171" />
              ) : (
                <Text className="text-center text-sm text-red-400">Delete Account</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Wizards' Fan Content Policy asks for this on the content itself,
              not only on the policy pages the paywall and sign-up link out to. */}
          <View className="border-t border-slate-800/80 pt-4">
            <Text className="text-[11px] leading-4 text-slate-500">{FAN_CONTENT_NOTICE}</Text>
            <Text className="mt-1.5 text-[11px] leading-4 text-slate-500">
              {DATA_SOURCE_NOTICE}
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <Text className="text-2xl font-bold text-white">{value}</Text>
      <Text className="text-xs uppercase tracking-wider text-slate-400">{label}</Text>
    </View>
  );
}
