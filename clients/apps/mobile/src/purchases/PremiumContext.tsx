import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import Purchases, {
  type CustomerInfo,
  type PurchasesPackage,
} from "react-native-purchases";
import { useAuth } from "../auth/AuthContext";

// RevenueCat public SDK keys (safe to ship in the client). Set these in
// app config / EAS secrets as EXPO_PUBLIC_* so they're inlined at build time.
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";
const API_KEY = (Platform.select({ ios: IOS_KEY, android: ANDROID_KEY }) ?? "").trim();

// Must match the entitlement identifier configured in the RevenueCat dashboard.
const ENTITLEMENT_ID = "premium";

// True once a key exists. Without one (e.g. Expo Go, dev), we skip RevenueCat
// entirely and fall back to the backend's is_premium flag so nothing crashes.
const CONFIGURED = API_KEY.length > 0;

let configured = false;
function configureOnce() {
  if (configured || !CONFIGURED) return;
  Purchases.configure({ apiKey: API_KEY });
  configured = true;
}

interface PremiumState {
  /** RevenueCat has an API key and is active on this build. */
  configured: boolean;
  /** Initial entitlement/offerings load has completed. */
  ready: boolean;
  /** The user currently has the Premium entitlement. */
  isPremium: boolean;
  /** Purchasable packages from the current ("default") offering. */
  packages: PurchasesPackage[];
  /** Purchase a package; resolves true if Premium is now active. */
  purchase: (pkg: PurchasesPackage) => Promise<boolean>;
  /** Restore prior purchases; resolves true if Premium is now active. */
  restore: () => Promise<boolean>;
}

const PremiumContext = createContext<PremiumState>({
  configured: false,
  ready: false,
  isPremium: false,
  packages: [],
  purchase: async () => false,
  restore: async () => false,
});

export function usePremium() {
  return useContext(PremiumContext);
}

function hasEntitlement(info: CustomerInfo | null): boolean {
  return !!info?.entitlements.active[ENTITLEMENT_ID];
}

export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(!CONFIGURED);
  const [rcPremium, setRcPremium] = useState(false);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);

  // Configure RevenueCat and subscribe to entitlement changes once.
  useEffect(() => {
    if (!CONFIGURED) return;
    configureOnce();
    const listener = (info: CustomerInfo) => setRcPremium(hasEntitlement(info));
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  // Identify the RevenueCat user with our account id so server webhooks can map
  // events back to the right account. Re-runs on login/logout.
  useEffect(() => {
    if (!CONFIGURED) return;
    let cancelled = false;
    (async () => {
      try {
        if (user) {
          const { customerInfo } = await Purchases.logIn(user.id);
          if (!cancelled) setRcPremium(hasEntitlement(customerInfo));
          const offerings = await Purchases.getOfferings();
          if (!cancelled) setPackages(offerings.current?.availablePackages ?? []);
        } else {
          await Purchases.logOut();
          if (!cancelled) setRcPremium(false);
        }
      } catch {
        // Network/native errors shouldn't block the app; treat as not-premium.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const purchase = useCallback(async (pkg: PurchasesPackage) => {
    if (!CONFIGURED) return false;
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const active = hasEntitlement(customerInfo);
      setRcPremium(active);
      return active;
    } catch (e: any) {
      if (e?.userCancelled) return false;
      throw e;
    }
  }, []);

  const restore = useCallback(async () => {
    if (!CONFIGURED) return false;
    const info = await Purchases.restorePurchases();
    const active = hasEntitlement(info);
    setRcPremium(active);
    return active;
  }, []);

  // RevenueCat is authoritative for a just-made purchase (the webhook may not
  // have landed yet); the backend flag covers the rest — webhook-synced
  // entitlements and permanently exempt accounts, which have no RC entitlement
  // at all. Either one unlocks, matching what the server actually enforces.
  const isPremium = (CONFIGURED && rcPremium) || !!user?.is_premium;

  return (
    <PremiumContext.Provider
      value={{ configured: CONFIGURED, ready, isPremium, packages, purchase, restore }}
    >
      {children}
    </PremiumContext.Provider>
  );
}
