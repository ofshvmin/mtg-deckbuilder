import { Redirect, Tabs, router } from "expo-router";
import { ActivityIndicator, TouchableOpacity, View, type ColorValue } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useAuth } from "../../src/auth/AuthContext";

// Line-art glyphs rather than emoji: emoji render in their own colours, so they
// ignore the active/inactive tint and clash with the dark + gold palette.
type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const TAB_ICONS: Record<string, IconName> = {
  home: "home-variant-outline",
  collection: "cards-outline",
  // Wand rather than a hammer — the build flow's headline feature is the AI
  // brief, marked with ✦ elsewhere in the app.
  build: "auto-fix",
  // A spellbook, for a deck builder called Grimoire.
  decks: "book-open-page-variant-outline",
};

function TabIcon({ name, color }: { name: string; color: ColorValue }) {
  return <MaterialCommunityIcons name={TAB_ICONS[name] ?? "circle-small"} size={24} color={color} />;
}

/** Opens the Account screen, which holds sign-out and account deletion. */
function ProfileButton() {
  return (
    <TouchableOpacity
      onPress={() => router.push("/account")}
      accessibilityRole="button"
      accessibilityLabel="Account"
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      className="mr-4 h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900"
      activeOpacity={0.7}
    >
      <MaterialCommunityIcons name="account-outline" size={18} color="#cbd5e1" />
    </TouchableOpacity>
  );
}

export default function TabsLayout() {
  const { user, loading } = useAuth();

  // Guard every tab, not just the entry route. Signing out clears the session
  // in place, so without this the tabs keep rendering against a dead session
  // and Sign Out looks like it did nothing.
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator size="large" color="#d8b25c" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#020617" },
        headerTintColor: "#f1f5f9",
        headerTitleStyle: { fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: "#020617",
          borderTopColor: "#1e293b",
        },
        tabBarActiveTintColor: "#d8b25c",
        tabBarInactiveTintColor: "#64748b",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <TabIcon name="home" color={color} />,
          headerTitle: "Grimoire",
          headerRight: () => <ProfileButton />,
        }}
      />
      <Tabs.Screen
        name="collection"
        options={{
          title: "Collection",
          tabBarIcon: ({ color }) => <TabIcon name="collection" color={color} />,
        }}
      />
      <Tabs.Screen
        name="build"
        options={{
          title: "Build",
          tabBarIcon: ({ color }) => <TabIcon name="build" color={color} />,
        }}
      />
      <Tabs.Screen
        name="decks"
        options={{
          title: "Decks",
          tabBarIcon: ({ color }) => <TabIcon name="decks" color={color} />,
        }}
      />
    </Tabs>
  );
}
