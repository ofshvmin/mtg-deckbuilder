import { useState } from "react";
import { View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { Redirect, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/auth/AuthContext";
import { api } from "../src/lib/api";
import { usePremium } from "../src/purchases/PremiumContext";

export default function AccountScreen() {
  const { user, logout, deleteAccount, setUser } = useAuth();
  const { isPremium } = usePremium();
  const [deleting, setDeleting] = useState(false);
  const insets = useSafeAreaInsets();

  // Recommendation budget — the same preference as the web's Settings page, so a
  // cap set on either side applies to both.
  const current = user?.preferences?.max_card_price;
  const [price, setPrice] = useState(current != null ? String(current) : "");
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceSaved, setPriceSaved] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  async function savePrice() {
    setPriceError(null);
    setPriceSaved(false);
    const trimmed = price.trim();
    const max_card_price = trimmed === "" ? null : Number(trimmed);
    if (max_card_price != null && (Number.isNaN(max_card_price) || max_card_price < 0)) {
      setPriceError("Enter a non-negative dollar amount, or leave blank for no cap.");
      return;
    }
    setSavingPrice(true);
    try {
      setUser(await api.updatePreferences({ max_card_price }));
      setPriceSaved(true);
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : "Couldn't save preferences.");
    } finally {
      setSavingPrice(false);
    }
  }

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
                      // Signing out clears the user; the tabs layout guard
                      // returns to the auth screen automatically.
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

  // This route sits outside (tabs), so the tabs layout's guard doesn't cover it.
  // Without this, signing out (or deleting the account) clears the session but
  // leaves the user staring at a logged-out Account screen.
  if (!user) {
    return <Redirect href="/login" />;
  }

  return (
    <ScrollView
      className="flex-1 bg-slate-950 px-6"
      // This route renders under a Slot, so there's no navigation header to
      // keep content clear of the status bar — same reason the paywall does it.
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
    >
      <TouchableOpacity onPress={() => router.back()} className="mb-6" activeOpacity={0.7}>
        <Text className="text-sm text-slate-400">‹ Back</Text>
      </TouchableOpacity>

      <Text className="mb-8 text-3xl font-bold text-slate-100">Account</Text>

      <Text className="text-xs uppercase tracking-wider text-slate-500">Signed in as</Text>
        <Text className="mt-1.5 text-base text-slate-100">{user?.email ?? "—"}</Text>

        <View className="mt-3 flex-row">
          <View
            className={`rounded-full px-2.5 py-1 ${
              isPremium ? "bg-amber-900/30 border border-amber-700/50" : "border border-slate-800"
            }`}
          >
            <Text className={`text-xs ${isPremium ? "text-amber-300" : "text-slate-400"}`}>
              {isPremium ? "Premium ✦" : "Free plan"}
            </Text>
          </View>
        </View>

        <View className="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <Text className="text-sm font-medium text-slate-200">Recommendation budget</Text>
          <Text className="mt-1 text-xs leading-4 text-slate-500">
            Maximum price you'll pay for a recommended card you don't own. Cards above this are
            hidden from combo finishers and budget upgrades. Leave blank for no cap. (Owned cards
            are always shown.)
          </Text>
          <View className="mt-3 flex-row items-center gap-2">
            <Text className="text-sm text-slate-400">$</Text>
            <TextInput
              value={price}
              onChangeText={(t) => {
                setPrice(t);
                setPriceSaved(false);
              }}
              placeholder="No cap"
              placeholderTextColor="#64748b"
              keyboardType="decimal-pad"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
            />
            <TouchableOpacity
              onPress={savePrice}
              disabled={savingPrice}
              className="rounded-lg bg-emerald-700 px-4 py-2"
              activeOpacity={0.7}
            >
              {savingPrice ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-sm font-medium text-white">Save</Text>
              )}
            </TouchableOpacity>
          </View>
          {priceError && <Text className="mt-2 text-xs text-rose-400">{priceError}</Text>}
          {priceSaved && <Text className="mt-2 text-xs text-emerald-400">Saved.</Text>}
        </View>

        <TouchableOpacity
          onPress={logout}
          className="mt-8 rounded-lg border border-slate-700 py-3"
          activeOpacity={0.7}
        >
          <Text className="text-center text-sm text-slate-300">Sign Out</Text>
        </TouchableOpacity>

        {/* Destructive actions live below a divider so they can't be hit by
            reflex on the way to Sign Out. */}
        <View className="mt-10 border-t border-slate-800 pt-6">
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
          <Text className="mt-2 text-center text-xs leading-4 text-slate-500">
            Permanently deletes your account, your entire collection, and all saved decks.
            This cannot be undone.
          </Text>
      </View>
    </ScrollView>
  );
}
