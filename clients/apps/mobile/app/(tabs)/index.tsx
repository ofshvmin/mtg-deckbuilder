import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import type { CollectionSummary, SavedDeckSummary } from "@mtg/shared";
import { api } from "../../src/lib/api";
import { useAuth } from "../../src/auth/AuthContext";
import { CommanderArtImage } from "../../src/components/CardImage";

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [recent, setRecent] = useState<SavedDeckSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.collectionSummary().then(setSummary).catch(() => null),
      api.listSavedDecks()
        .then((d) => setRecent([...d].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 4)))
        .catch(() => []),
    ]).finally(() => setLoading(false));
  }, []);

  const greeting = user?.email?.split("@")[0] ?? "there";

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
            <StatCard label="Decks" value={recent.length} />
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
                    onPress={() => router.push("/(tabs)/decks")}
                    activeOpacity={0.7}
                    className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60"
                  >
                    <View style={{ height: 80 }}>
                      <CommanderArtImage
                        name={d.commander_name}
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

          {/* Sign out */}
          <TouchableOpacity
            onPress={logout}
            className="rounded-lg border border-slate-700 py-3"
            activeOpacity={0.7}
          >
            <Text className="text-center text-sm text-slate-400">Sign Out</Text>
          </TouchableOpacity>
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
