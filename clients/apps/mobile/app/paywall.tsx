import { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Linking,
} from "react-native";
import { router } from "expo-router";
import type { PurchasesPackage } from "react-native-purchases";
import { usePremium } from "../src/purchases/PremiumContext";

const WEB_URL =
  process.env.EXPO_PUBLIC_WEB_URL ?? "https://mtg-deckbuilder-bice.vercel.app";

const PERKS = [
  "Unlimited saved decks",
  "AI deck brief — describe a deck in plain English",
  "Support ongoing development",
];

export default function PaywallScreen() {
  const { configured, ready, isPremium, packages, purchase, restore } = usePremium();
  const [busy, setBusy] = useState<string | null>(null);

  async function handlePurchase(pkg: PurchasesPackage) {
    setBusy(pkg.identifier);
    try {
      const ok = await purchase(pkg);
      if (ok) {
        Alert.alert("You're Premium!", "Thanks for supporting Grimoire.");
        router.back();
      }
    } catch {
      Alert.alert("Purchase failed", "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    setBusy("restore");
    try {
      const ok = await restore();
      Alert.alert(
        ok ? "Purchases restored" : "Nothing to restore",
        ok ? "Your Premium access is active." : "We couldn't find a previous purchase.",
      );
      if (ok) router.back();
    } catch {
      Alert.alert("Restore failed", "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView className="flex-1 bg-slate-950 px-6 py-8">
      <TouchableOpacity onPress={() => router.back()} className="mb-6" activeOpacity={0.7}>
        <Text className="text-sm text-slate-400">✕ Close</Text>
      </TouchableOpacity>

      <Text className="text-3xl font-bold text-slate-100">Grimoire Premium</Text>
      <Text className="mt-2 text-sm text-slate-400">
        Unlock the full deck-building toolkit.
      </Text>

      <View className="mt-6 gap-3">
        {PERKS.map((perk) => (
          <View key={perk} className="flex-row items-start gap-3">
            <Text className="text-base text-amber-400">✦</Text>
            <Text className="flex-1 text-base text-slate-200">{perk}</Text>
          </View>
        ))}
      </View>

      <View className="mt-8 gap-3">
        {isPremium ? (
          <View className="rounded-xl border border-emerald-700/50 bg-emerald-900/20 p-4">
            <Text className="text-center text-base font-semibold text-emerald-300">
              You already have Premium ✦
            </Text>
          </View>
        ) : !ready ? (
          <ActivityIndicator size="large" color="#d8b25c" className="mt-4" />
        ) : !configured || packages.length === 0 ? (
          <Text className="text-center text-sm text-slate-500">
            Purchases aren't available right now. Please try again later.
          </Text>
        ) : (
          packages.map((pkg) => (
            <TouchableOpacity
              key={pkg.identifier}
              onPress={() => handlePurchase(pkg)}
              disabled={busy !== null}
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 disabled:opacity-50"
              activeOpacity={0.8}
            >
              {busy === pkg.identifier ? (
                <ActivityIndicator color="#d8b25c" />
              ) : (
                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-semibold text-amber-200">
                    {pkg.product.title}
                  </Text>
                  <Text className="text-base font-bold text-amber-100">
                    {pkg.product.priceString}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))
        )}

        {!isPremium && (
          <TouchableOpacity
            onPress={handleRestore}
            disabled={busy !== null}
            className="py-3"
            activeOpacity={0.7}
          >
            <Text className="text-center text-sm text-slate-400">Restore purchases</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Apple-required subscription disclosure + legal links. */}
      <Text className="mt-8 text-center text-xs leading-5 text-slate-500">
        Subscriptions renew automatically unless canceled at least 24 hours before the
        end of the current period. Manage or cancel anytime in your App Store account
        settings. A one-time lifetime unlock is a single non-renewing purchase.
        {"\n"}
        <Text className="underline" onPress={() => Linking.openURL(`${WEB_URL}/terms.html`)}>
          Terms
        </Text>
        {"  ·  "}
        <Text className="underline" onPress={() => Linking.openURL(`${WEB_URL}/privacy.html`)}>
          Privacy Policy
        </Text>
      </Text>
    </ScrollView>
  );
}
