import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { Link, router } from "expo-router";
import { useAuth } from "../src/auth/AuthContext";

export default function RegisterScreen() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      await register(email.trim(), password);
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-slate-950"
    >
      <View className="flex-1 justify-center px-8">
        <Text className="mb-2 text-center text-3xl font-bold text-slate-100">Grimoire</Text>
        <Text className="mb-8 text-center text-sm text-slate-400">Create your account</Text>

        {error && (
          <Text className="mb-4 text-center text-sm text-rose-400">{error}</Text>
        )}

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          className="mb-3 rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="#64748b"
          secureTextEntry
          textContentType="newPassword"
          className="mb-6 rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200"
        />

        <TouchableOpacity
          onPress={handleRegister}
          disabled={loading || !email.trim() || !password}
          className="rounded-lg bg-indigo-600 py-3 disabled:opacity-50"
          activeOpacity={0.7}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-center text-sm font-semibold text-white">Create Account</Text>
          )}
        </TouchableOpacity>

        <Link href="/login" asChild>
          <TouchableOpacity className="mt-4 py-2" activeOpacity={0.7}>
            <Text className="text-center text-sm text-slate-400">
              Already have an account? <Text className="text-indigo-400">Sign in</Text>
            </Text>
          </TouchableOpacity>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}
