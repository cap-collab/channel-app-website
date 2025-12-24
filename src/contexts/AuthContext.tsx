"use client";

import { createContext, useContext, ReactNode } from "react";
import { User } from "firebase/auth";
import { useAuth } from "@/hooks/useAuth";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  emailSent: boolean;
  signInWithGoogle: (enableNotifications?: boolean, djUsername?: string) => Promise<User | null>;
  signInWithApple: (enableNotifications?: boolean, djUsername?: string) => Promise<User | null>;
  sendEmailLink: (email: string, enableNotifications?: boolean) => Promise<boolean>;
  resetEmailSent: () => void;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
