import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

function normalizeUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return /^https?:\/\//i.test(value) ? value.replace(/\/+$/, '') : `https://${value}`;
}

function getWebAppUrl(): string {
  const extra = Constants.expoConfig?.extra as
    | { webAppUrl?: string; apiBaseUrl?: string }
    | undefined;
  const baseUrl =
    normalizeUrl(process.env.EXPO_PUBLIC_WEB_APP_URL) ??
    normalizeUrl(extra?.webAppUrl) ??
    normalizeUrl(extra?.apiBaseUrl);

  if (!baseUrl) {
    throw new Error('The mobile app is missing its web app URL configuration.');
  }
  return baseUrl;
}

export default function WebAppScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [opening, setOpening] = useState<'app' | 'invoices' | null>(null);
  const webAppUrl = useMemo(() => getWebAppUrl(), []);

  const openWebApp = async (path: '/' | '/invoices', action: 'app' | 'invoices') => {
    setOpening(action);
    try {
      await WebBrowser.openBrowserAsync(`${webAppUrl}${path}`);
    } finally {
      setOpening(null);
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 24),
          paddingBottom: insets.bottom + 32,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.primary }]}>
        <Feather name="globe" size={28} color={colors.primaryForeground} />
      </View>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>915MOTORS</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Full web app</Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>
        Open the complete 915motors shop system without converting it into a
        second mobile interface.
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeading}>
          <View style={[styles.cardIcon, { backgroundColor: colors.secondary }]}>
            <Feather name="monitor" size={19} color={colors.foreground} />
          </View>
          <View style={styles.cardCopy}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>915motors web app</Text>
            <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
              Inventory, customers, repair orders, estimates, and settings
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => void openWebApp('/', 'app')}
          disabled={opening !== null}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary, opacity: pressed || opening !== null ? 0.75 : 1 },
          ]}
          testID="open-web-app-button"
        >
          {opening === 'app' ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="external-link" size={18} color={colors.primaryForeground} />
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
                Open web app
              </Text>
            </>
          )}
        </Pressable>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeading}>
          <View style={[styles.cardIcon, { backgroundColor: colors.secondary }]}>
            <Feather name="file-text" size={19} color={colors.foreground} />
          </View>
          <View style={styles.cardCopy}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Invoices</Text>
            <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
              Open invoices in the web app, or use the native Invoices tab for Square payments.
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => void openWebApp('/invoices', 'invoices')}
          disabled={opening !== null}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: colors.border, opacity: pressed || opening !== null ? 0.75 : 1 },
          ]}
          testID="open-web-invoices-button"
        >
          {opening === 'invoices' ? (
            <ActivityIndicator color={colors.foreground} />
          ) : (
            <>
              <Feather name="file-text" size={18} color={colors.foreground} />
              <Text style={[styles.buttonText, { color: colors.foreground }]}>
                Open web invoices
              </Text>
            </>
          )}
        </Pressable>
      </View>

      <Text style={[styles.note, { color: colors.mutedForeground }]}>
        The native Invoices tab remains available for fast invoice lookup and
        Square Point of Sale payments.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20 },
  icon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.4, marginTop: 20 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 30, marginTop: 4 },
  description: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 22 },
  card: { borderWidth: 1, borderRadius: 10, padding: 16, marginBottom: 14 },
  cardHeading: { flexDirection: 'row', alignItems: 'flex-start' },
  cardIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, marginLeft: 12 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  cardMeta: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 4 },
  primaryButton: { minHeight: 50, borderRadius: 7, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  secondaryButton: { minHeight: 50, borderWidth: 1, borderRadius: 7, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  note: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 4 },
});