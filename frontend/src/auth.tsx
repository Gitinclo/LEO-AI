/**
 * Auth context for Emergent Google Auth (mobile-only since this app is for Expo Go).
 * Stores session_token in expo-secure-store and exposes user state + login/logout.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL!;
const TOKEN_KEY = 'leo_session_token';

export type LeoUser = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  credits?: number;
  is_admin?: boolean;
};

type AuthState = {
  loading: boolean;
  user: LeoUser | null;
  token: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  refreshUser: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}
async function storageSet(key: string, value: string) {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
async function storageDel(key: string) {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.removeItem(key);
    } catch {}
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function parseSessionId(url: string | null): string | null {
  if (!url) return null;
  // hash form
  const hashIdx = url.indexOf('#');
  if (hashIdx !== -1) {
    const hash = url.slice(hashIdx + 1);
    const params = new URLSearchParams(hash);
    const sid = params.get('session_id');
    if (sid) return sid;
  }
  // query form
  const qIdx = url.indexOf('?');
  if (qIdx !== -1) {
    const q = url.slice(qIdx + 1).split('#')[0];
    const params = new URLSearchParams(q);
    const sid = params.get('session_id');
    if (sid) return sid;
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<LeoUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const processingRef = useRef(false);

  const exchangeSessionId = useCallback(async (sessionId: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      const r = await fetch(`${BASE}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!r.ok) throw new Error(`auth/session failed: ${r.status}`);
      const data = await r.json();
      await storageSet(TOKEN_KEY, data.session_token);
      setToken(data.session_token);
      setUser(data.user);
    } catch (e) {
      console.warn('exchangeSessionId error', e);
    } finally {
      processingRef.current = false;
    }
  }, []);

  const verifyExisting = useCallback(async () => {
    const t = await storageGet(TOKEN_KEY);
    if (!t) return false;
    try {
      const r = await fetch(`${BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (r.status === 401) {
        await storageDel(TOKEN_KEY);
        return false;
      }
      if (!r.ok) return false;
      const u = await r.json();
      setUser(u);
      setToken(t);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Bootstrap
  useEffect(() => {
    let mounted = true;
    (async () => {
      // Web: parse session_id from URL first
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const sid =
          parseSessionId(window.location.hash ? '#' + window.location.hash.slice(1) : '') ||
          parseSessionId(window.location.search ? '?' + window.location.search.slice(1) : '');
        if (sid) {
          await exchangeSessionId(sid);
          try {
            window.history.replaceState(null, '', window.location.pathname);
          } catch {}
          if (mounted) setLoading(false);
          return;
        }
      }
      // Mobile cold-start: getInitialURL
      if (Platform.OS !== 'web') {
        const initial = await Linking.getInitialURL();
        const sid = parseSessionId(initial);
        if (sid) {
          await exchangeSessionId(sid);
          if (mounted) setLoading(false);
          return;
        }
      }
      await verifyExisting();
      if (mounted) setLoading(false);
    })();

    // Mobile: listen for hot links
    let sub: { remove: () => void } | null = null;
    if (Platform.OS !== 'web') {
      sub = Linking.addEventListener('url', ({ url }) => {
        const sid = parseSessionId(url);
        if (sid) exchangeSessionId(sid);
      });
    }
    return () => {
      mounted = false;
      sub?.remove();
    };
  }, [exchangeSessionId, verifyExisting]);

  const login = useCallback(async () => {
    if (Platform.OS === 'web') {
      const redirect = window.location.origin + '/';
      window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      return;
    }
    const redirect = Linking.createURL('auth');
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
    if (result.type === 'success' && result.url) {
      const sid = parseSessionId(result.url);
      if (sid) await exchangeSessionId(sid);
    }
  }, [exchangeSessionId]);

  const logout = useCallback(async () => {
    const t = token;
    setToken(null);
    setUser(null);
    await storageDel(TOKEN_KEY);
    if (t) {
      try {
        await fetch(`${BASE}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${t}` },
        });
      } catch {}
    }
  }, [token]);

  const authFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = {
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      return fetch(`${BASE}${path}`, { ...init, headers });
    },
    [token]
  );

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const u = await r.json();
        setUser(u);
      }
    } catch {}
  }, [token]);

  const value = useMemo<AuthState>(
    () => ({ loading, user, token, login, logout, authFetch, refreshUser }),
    [loading, user, token, login, logout, authFetch, refreshUser]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
