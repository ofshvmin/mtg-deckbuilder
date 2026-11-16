import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { router } from "expo-router";
import { api } from "../src/lib/api";

// Sends the reset email. The link in it opens the web app's reset page, which
// sets the new password; the user then signs in here with it. No deep link
// needed — the reset itself never has to happen in the app.
export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim());
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
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
        <Text className="mb-2 text-center text-3xl font-bold text-slate-100">Reset password</Text>

        {submitted ? (
          <>
            <Text className="mb-8 mt-2 text-center text-sm leading-5 text-slate-300">
              If an account exists for <Text className="font-medium text-slate-100">{email.trim()}</Text>,
              we've sent a password reset link. Open it to choose a new password, then sign in here.
            </Text>
            <TouchableOpacity
              onPress={() => router.replace("/login")}
              className="rounded-lg bg-indigo-600 py-3"
              activeOpacity={0.7}
            >
              <Text className="text-center text-sm font-semibold text-white">Back to sign in</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text className="mb-8 text-center text-sm text-slate-400">
              Enter your email and we'll send you a link to reset your password.
            </Text>

            {error && <Text className="mb-4 text-center text-sm text-rose-400">{error}</Text>}

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
              className="mb-6 rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-200"
            />

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={loading || !email.trim()}
              className="rounded-lg bg-indigo-600 py-3 disabled:opacity-50"
              activeOpacity={0.7}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-center text-sm font-semibold text-white">Send reset link</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.back()} className="mt-4 py-2" activeOpacity={0.7}>
              <Text className="text-center text-sm text-slate-400">Back to sign in</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
