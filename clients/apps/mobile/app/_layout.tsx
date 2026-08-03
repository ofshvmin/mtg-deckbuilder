import "../global.css";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/auth/AuthContext";
import { PremiumProvider } from "../src/purchases/PremiumContext";

export default function RootLayout() {
  return (
    // Headerless routes (paywall, login, register) read insets directly, which
    // silently returns zeros without this provider.
    <SafeAreaProvider>
      <AuthProvider>
        <PremiumProvider>
          <StatusBar style="light" />
          <Slot />
        </PremiumProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
