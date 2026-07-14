import React, { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@mtg/shared";
import { api } from "../lib/api";
import { secureTokenStore } from "../lib/tokenStore";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await secureTokenStore.getAccess();
      if (token) {
        try {
          const me = await api.me();
          setUser(me);
        } catch {
          await secureTokenStore.clear();
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    await api.login(email, password);
    const me = await api.me();
    setUser(me);
  };

  const register = async (email: string, password: string) => {
    await api.register(email, password);
    const me = await api.me();
    setUser(me);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
