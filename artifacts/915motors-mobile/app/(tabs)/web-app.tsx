import Constants from 'expo-constants';
import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, type WebViewErrorEvent, type WebView as WebViewType } from 'react-native-webview';
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
  const webViewRef = useRef<WebViewType>(null);
  const webAppUrl = useMemo(() => getWebAppUrl(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const retry = () => {
    setError(null);
    setLoading(true);
    webViewRef.current?.reload();
  };

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 62,
        },
      ]}
    >
      {error ? (
        <View style={styles.errorState}>
          <View style={[styles.errorIcon, { backgroundColor: colors.muted }]}>
            <Feather name="wifi-off" size={26} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>
            Web app unavailable
          </Text>
          <Text style={[styles.errorMessage, { color: colors.mutedForeground }]}>
            Check your connection and try loading the 915motors web app again.
          </Text>
          <Pressable
            onPress={retry}
            style={({ pressed }) => [
              styles.retryButton,
              { backgroundColor: colors.primary, opacity: pressed ? 0.75 : 1 },
            ]}
            testID="retry-web-app-button"
          >
            <Feather name="refresh-cw" size={17} color={colors.primaryForeground} />
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <WebView
            ref={webViewRef}
            source={{ uri: webAppUrl }}
            style={styles.webView}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            allowsBackForwardNavigationGestures
            startInLoadingState
            onLoadStart={() => {
              setError(null);
              setLoading(true);
            }}
            onLoadEnd={() => setLoading(false)}
            onError={(event: WebViewErrorEvent) => {
              setLoading(false);
              setError(event.nativeEvent.description || 'Unable to load the web app.');
            }}
            testID="embedded-web-app"
          />
          {loading ? (
            <View style={[styles.loadingOverlay, { backgroundColor: colors.background }]}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                Loading 915motors…
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  webView: { flex: 1, backgroundColor: 'transparent' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    marginTop: 12,
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    marginTop: 16,
  },
  errorMessage: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 48,
    borderRadius: 7,
    paddingHorizontal: 18,
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  retryText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
});