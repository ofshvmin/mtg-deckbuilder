import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from "react-native";
import type { CollectionSummary, HealthStatus } from "@mtg/shared";
import { api } from "../../src/lib/api";
import { useAuth } from "../../src/auth/AuthContext";

export default function HomeScreen() {
  const { user, logout } = useAuth();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.health().then(setHealth).catch(() => null),
      api.collectionSummary().then(setSummary).catch(() => null),
      api.listSavedDecks().then((d) => setSavedCount(d.length)).catch(() => 0),
    ]).finally(() => setLoading(false));
  }, []);

  return (
    <ScrollView className="flex-1 bg-slate-950 px-4 py-6">
      <Text className="mb-1 text-2xl font-bold text-slate-100">
        Welcome back{user?.email ? `, ${user.email.split("@")[0]}` : ""}
      </Text>
      <Text className="mb-6 text-sm text-slate-400">What are we building today?</Text>

      {loading ? (
        <ActivityIndicator size="large" color="#d8b25c" className="mt-10" />
      ) : (
        <View className="gap-4">
          {/* Stats */}
          <View className="flex-row gap-3">
            <StatCard label="Cards" value={summary?.total_cards ?? 0} />
            <StatCard label="Unique" value={summary?.unique_cards ?? 0} />
            <StatCard label="Decks" value={savedCount} />
          </View>

          {/* Backend status */}
          <View className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <Text className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Backend
            </Text>
            <Text className="mt-1 text-sm text-slate-200">
              {health ? `${health.status} — v${health.version}` : "Connecting…"}
            </Text>
            <Text className="text-xs text-slate-500">
              DB: {health?.db_connected ? "connected" : "disconnected"}
            </Text>
          </View>

          {/* Sign out */}
          <TouchableOpacity
            onPress={logout}
            className="mt-4 rounded-lg border border-slate-700 py-3"
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
      <Text className="text-2xl font-bold tabular-nums text-white">{value}</Text>
      <Text className="text-xs uppercase tracking-wider text-slate-400">{label}</Text>
    </View>
  );
}
