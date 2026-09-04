import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getCurrentUser,
  login,
  type AuthUser,
} from '@workspace/api-client-react';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export const MOBILE_TOKEN_KEY = 'motors915.mobileToken';

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    AsyncStorage.getItem(MOBILE_TOKEN_KEY)
      .then(async (token) => {
        if (!token) return;
        try {
          const response = await getCurrentUser();
          if (current) setUser(response.user);
        } catch {
          await AsyncStorage.removeItem(MOBILE_TOKEN_KEY);
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const response = await login({ username, password, mobile: true });
    if (!response.mobileToken) throw new Error('Server did not issue a mobile token');
    await AsyncStorage.setItem(MOBILE_TOKEN_KEY, response.mobileToken);
    setUser(response.user);
  }, []);

  const signOut = useCallback(async () => {
    await AsyncStorage.removeItem(MOBILE_TOKEN_KEY);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut }),
    [user, loading, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}