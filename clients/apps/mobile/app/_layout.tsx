import "../global.css";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/auth/AuthContext";
import { PremiumProvider } from "../src/purchases/PremiumContext";

export default function RootLayout() {
  return (
    <AuthProvider>
      <PremiumProvider>
        <StatusBar style="light" />
        <Slot />
      </PremiumProvider>
    </AuthProvider>
  );
}
