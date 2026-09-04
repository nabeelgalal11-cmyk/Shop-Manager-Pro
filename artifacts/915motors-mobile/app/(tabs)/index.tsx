import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import {
  type Invoice,
  type SquarePosPrepareResult,
  useCompleteSquarePosPayment,
  useGetInvoice,
  useGetInvoices,
  usePrepareSquarePosPayment,
} from '@workspace/api-client-react';
import * as Linking from 'expo-linking';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useAuth } from '@/contexts/AuthContext';
import { useColors } from '@/hooks/useColors';

const PENDING_PAYMENT_KEY = 'motors915.pendingSquarePayment';

type PendingPayment = {
  invoiceId: number;
  state: string;
  createdAt: string;
};

type PaymentNotice = {
  kind: 'success' | 'failure' | 'pending';
  message: string;
} | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function formatMoney(value: number | string | undefined): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number.isFinite(amount) ? amount : 0);
}

function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.flex, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.loginContent,
        {
          paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 28),
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 28),
        },
      ]}
      bottomOffset={64}
    >
      <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
        <Feather name="tool" color={colors.primaryForeground} size={28} />
      </View>
      <Text style={[styles.brand, { color: colors.foreground }]}>915motors</Text>
      <Text style={[styles.loginSubtitle, { color: colors.mutedForeground }]}>
        Secure staff payments
      </Text>
      <View style={[styles.loginCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.foreground }]}>Username</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
          placeholder="Staff username"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground, borderColor: colors.input }]}
          testID="username-input"
        />
        <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground, borderColor: colors.input }]}
          onSubmitEditing={submit}
          testID="password-input"
        />
        {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
        <Pressable
          disabled={submitting}
          onPress={submit}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: colors.primary, opacity: pressed || submitting ? 0.7 : 1 },
          ]}
          testID="sign-in-button"
        >
          {submitting ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Sign in</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

function buildSquareUrl(prepared: SquarePosPrepareResult): string {
  if (Platform.OS === 'ios') {
    const data = {
      amount_money: {
        amount: prepared.amountMoney.amount,
        currency_code: prepared.amountMoney.currencyCode,
      },
      callback_url: prepared.callbackUrl,
      client_id: prepared.clientId,
      options: {
        supported_tender_types: prepared.options.supportedTenderTypes,
      },
      version: prepared.version,
      location_id: prepared.locationId,
      state: prepared.state,
      notes: prepared.notes,
    };
    return `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(data))}`;
  }
  if (Platform.OS === 'android') {
    const extra = (value: string) => encodeURIComponent(value);
    return [
      'intent:#Intent',
      'action=com.squareup.pos.action.CHARGE',
      'package=com.squareup',
      `S.com.squareup.pos.WEB_CALLBACK_URI=${extra(prepared.callbackUrl)}`,
      `i.com.squareup.pos.TOTAL_AMOUNT=${prepared.amountMoney.amount}`,
      'S.com.squareup.pos.CURRENCY_CODE=USD',
      `S.com.squareup.pos.CLIENT_ID=${extra(prepared.clientId)}`,
      'S.com.squareup.pos.API_VERSION=v2.0',
      `S.com.squareup.pos.LOCATION_ID=${extra(prepared.locationId)}`,
      `S.com.squareup.pos.NOTE=${extra(prepared.notes)}`,
      `S.com.squareup.pos.REQUEST_METADATA=${extra(prepared.state)}`,
      'end',
    ].join(';');
  }
  throw new Error('Square Point of Sale handoff is available only on iOS and Android.');
}

function PaymentPanel({
  invoice,
  onFinished,
}: {
  invoice: Invoice;
  onFinished: () => Promise<void>;
}) {
  const colors = useColors();
  const [amount, setAmount] = useState(Number(invoice.balance).toFixed(2));
  const [notice, setNotice] = useState<PaymentNotice>(null);
  const handledCallbackUrls = useRef<Set<string>>(new Set());
  const prepare = usePrepareSquarePosPayment();
  const complete = useCompleteSquarePosPayment();

  const reconcileCallback = useCallback(
    async (url: string) => {
      if (handledCallbackUrls.current.has(url)) return;
      const parsed = Linking.parse(url);
      if (parsed.scheme !== 'motors915') return;
      handledCallbackUrls.current.add(url);
      const params = parsed.queryParams ?? {};
      const value = (key: string): string | undefined => {
        const candidate = params[key];
        return Array.isArray(candidate) ? candidate[0] : candidate?.toString();
      };
      const pendingJson = await AsyncStorage.getItem(PENDING_PAYMENT_KEY);
      if (!pendingJson) return;
      const pending = JSON.parse(pendingJson) as PendingPayment;
      const status = value('status')?.toLowerCase();
      const errorCode = value('error_code') ?? value('com.squareup.pos.ERROR_CODE');
      if (status === 'cancel' || status === 'canceled' || errorCode === 'PAYMENT_CANCELED') {
        await AsyncStorage.removeItem(PENDING_PAYMENT_KEY);
        setNotice({ kind: 'failure', message: 'Payment was canceled in Square.' });
        return;
      }
      if (errorCode) {
        await AsyncStorage.removeItem(PENDING_PAYMENT_KEY);
        setNotice({
          kind: 'failure',
          message: value('error_description') ?? `Square returned ${errorCode}.`,
        });
        return;
      }
      const paymentId =
        value('payment_id') ??
        value('transaction_id') ??
        value('com.squareup.pos.SERVER_TRANSACTION_ID');
      if (!paymentId) {
        setNotice({
          kind: 'pending',
          message: 'Square returned without a verifiable payment ID. No invoice credit was applied.',
        });
        return;
      }
      setNotice({ kind: 'pending', message: 'Verifying payment with Square…' });
      try {
        const result = await complete.mutateAsync({
          data: { state: value('state') ?? pending.state, paymentId },
        });
        await AsyncStorage.removeItem(PENDING_PAYMENT_KEY);
        setNotice({
          kind: result.status === 'COMPLETED' ? 'success' : 'pending',
          message:
            result.status === 'COMPLETED'
              ? 'Payment verified and applied.'
              : `Square payment status: ${result.status}.`,
        });
        await onFinished();
      } catch (cause) {
        setNotice({
          kind: 'pending',
          message: `Payment is not yet reconciled: ${errorMessage(cause)}`,
        });
      }
    },
    [complete, onFinished],
  );

  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void reconcileCallback(url);
    });
    Linking.getInitialURL().then((url) => {
      if (url) void reconcileCallback(url);
    });
    return () => subscription.remove();
  }, [reconcileCallback]);

  const takePayment = async () => {
    if (Platform.OS === 'web') {
      setNotice({
        kind: 'failure',
        message: 'Square Point of Sale handoff is disabled on web. Use the installed mobile app.',
      });
      return;
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > Number(invoice.balance)) {
      setNotice({ kind: 'failure', message: 'Enter an amount up to the outstanding balance.' });
      return;
    }
    setNotice(null);
    try {
      const prepared = await prepare.mutateAsync({
        data: { invoiceId: invoice.id, amount: numericAmount },
      });
      const pending: PendingPayment = {
        invoiceId: invoice.id,
        state: prepared.state,
        createdAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(pending));
      setNotice({ kind: 'pending', message: 'Complete payment in Square Point of Sale.' });
      await Linking.openURL(buildSquareUrl(prepared));
    } catch (cause) {
      Alert.alert(
        'Square Point of Sale unavailable',
        `${errorMessage(cause)} Make sure the official Square Point of Sale app is installed and signed in.`,
      );
      setNotice({ kind: 'failure', message: errorMessage(cause) });
    }
  };

  return (
    <View style={[styles.paymentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Take payment</Text>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>Amount</Text>
      <View style={[styles.amountInputRow, { borderColor: colors.input }]}>
        <Text style={[styles.currency, { color: colors.mutedForeground }]}>$</Text>
        <TextInput
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          style={[styles.amountInput, { color: colors.foreground }]}
          testID="payment-amount-input"
        />
      </View>
      <Pressable
        disabled={prepare.isPending || complete.isPending}
        onPress={takePayment}
        style={({ pressed }) => [
          styles.takePaymentButton,
          { backgroundColor: colors.primary, opacity: pressed ? 0.75 : 1 },
        ]}
        testID="take-payment-button"
      >
        <Feather name="credit-card" size={21} color={colors.primaryForeground} />
        <Text style={[styles.takePaymentText, { color: colors.primaryForeground }]}>Take payment</Text>
      </Pressable>
      {notice ? (
        <View
          style={[
            styles.notice,
            {
              backgroundColor:
                notice.kind === 'success'
                  ? colors.accent
                  : notice.kind === 'failure'
                    ? colors.muted
                    : colors.secondary,
            },
          ]}
        >
          <Feather
            name={notice.kind === 'success' ? 'check-circle' : notice.kind === 'failure' ? 'alert-circle' : 'clock'}
            size={18}
            color={notice.kind === 'failure' ? colors.destructive : colors.foreground}
          />
          <Text style={[styles.noticeText, { color: colors.foreground }]}>{notice.message}</Text>
        </View>
      ) : null}
    </View>
  );
}

function InvoiceDetail({ invoiceId, onBack }: { invoiceId: number; onBack: () => void }) {
  const colors = useColors();
  const query = useGetInvoice(invoiceId);
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  if (query.isLoading || !query.data) {
    return <ActivityIndicator style={styles.loader} color={colors.primary} />;
  }
  const invoice = query.data;
  return (
    <FlatList
      data={invoice.payments ?? []}
      keyExtractor={(payment) => String(payment.id)}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={refresh} tintColor={colors.primary} />}
      contentContainerStyle={styles.detailContent}
      ListHeaderComponent={
        <>
          <Pressable onPress={onBack} style={styles.backButton} testID="back-to-invoices">
            <Feather name="arrow-left" size={22} color={colors.foreground} />
            <Text style={[styles.backText, { color: colors.foreground }]}>Invoices</Text>
          </Pressable>
          <View style={styles.detailHeading}>
            <View>
              <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>INVOICE</Text>
              <Text style={[styles.detailTitle, { color: colors.foreground }]}>#{invoice.invoiceNumber}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.statusText, { color: colors.secondaryForeground }]}>{invoice.status}</Text>
            </View>
          </View>
          <View style={[styles.balanceCard, { backgroundColor: colors.foreground }]}>
            <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>BALANCE DUE</Text>
            <Text style={[styles.balanceAmount, { color: colors.background }]}>{formatMoney(invoice.balance)}</Text>
            <Text style={[styles.balanceMeta, { color: colors.mutedForeground }]}>
              Total {formatMoney(invoice.total)} · Paid {formatMoney(invoice.amountPaid)}
            </Text>
          </View>
          <PaymentPanel key={invoice.id} invoice={invoice} onFinished={refresh} />
          <Text style={[styles.sectionTitle, styles.historyTitle, { color: colors.foreground }]}>Payment history</Text>
        </>
      }
      renderItem={({ item }) => (
        <View style={[styles.historyRow, { borderBottomColor: colors.border }]}>
          <View style={[styles.historyIcon, { backgroundColor: colors.muted }]}>
            <Feather name="credit-card" size={17} color={colors.foreground} />
          </View>
          <View style={styles.historyCopy}>
            <Text style={[styles.historyMethod, { color: colors.foreground }]}>{item.method.replaceAll('_', ' ')}</Text>
            <Text style={[styles.historyStatus, { color: colors.mutedForeground }]}>{item.status ?? 'succeeded'}</Text>
          </View>
          <Text style={[styles.historyAmount, { color: colors.foreground }]}>{formatMoney(item.amount)}</Text>
        </View>
      )}
      ListEmptyComponent={
        <Text style={[styles.emptyHistory, { color: colors.mutedForeground }]}>No payments recorded.</Text>
      }
    />
  );
}

function InvoiceHome() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const query = useGetInvoices({ page: 1, limit: 100 });
  useEffect(() => {
    AsyncStorage.getItem(PENDING_PAYMENT_KEY).then((value) => {
      if (!value) return;
      try {
        const pending = JSON.parse(value) as PendingPayment;
        if (Number.isSafeInteger(pending.invoiceId) && pending.invoiceId > 0) {
          setSelectedId(pending.invoiceId);
        }
      } catch {
        AsyncStorage.removeItem(PENDING_PAYMENT_KEY);
      }
    });
  }, []);
  const invoices = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data?.data ?? []).filter((invoice) => {
      const open = Number(invoice.balance) > 0 && invoice.status !== 'void' && invoice.status !== 'paid';
      if (!open) return false;
      if (!term) return true;
      const customer = invoice.customer
        ? `${invoice.customer.firstName} ${invoice.customer.lastName}`.toLowerCase()
        : '';
      return invoice.invoiceNumber.toLowerCase().includes(term) || customer.includes(term);
    });
  }, [query.data, search]);

  return (
    <View
      style={[
        styles.flex,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0),
        },
      ]}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>915MOTORS</Text>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {selectedId ? 'Invoice detail' : 'Open invoices'}
          </Text>
        </View>
        <Pressable onPress={signOut} accessibilityLabel="Sign out" testID="sign-out-button">
          <Feather name="log-out" size={22} color={colors.mutedForeground} />
        </Pressable>
      </View>
      {selectedId ? (
        <InvoiceDetail invoiceId={selectedId} onBack={() => setSelectedId(null)} />
      ) : (
        <>
          <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={19} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Invoice or customer"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground }]}
              testID="invoice-search-input"
            />
          </View>
          <Text style={[styles.resultCount, { color: colors.mutedForeground }]}>
            {invoices.length} open · {user?.firstName}
          </Text>
          <FlatList
            data={invoices}
            keyExtractor={(invoice) => String(invoice.id)}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={query.isRefetching}
                onRefresh={query.refetch}
                tintColor={colors.primary}
              />
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => setSelectedId(item.id)}
                style={({ pressed }) => [
                  styles.invoiceRow,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
                testID={`invoice-${item.id}`}
              >
                <View style={styles.invoiceCopy}>
                  <Text style={[styles.invoiceNumber, { color: colors.foreground }]}>#{item.invoiceNumber}</Text>
                  <Text style={[styles.customerName, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {item.customer
                      ? `${item.customer.firstName} ${item.customer.lastName}`
                      : 'Customer unavailable'}
                  </Text>
                </View>
                <View style={styles.invoiceAmount}>
                  <Text style={[styles.rowAmount, { color: colors.foreground }]}>{formatMoney(item.balance)}</Text>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </View>
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Feather name="check-circle" size={36} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  {query.isLoading ? 'Loading invoices…' : 'No open invoices'}
                </Text>
                {query.isError ? (
                  <Text style={[styles.errorText, { color: colors.destructive }]}>
                    {errorMessage(query.error)}
                  </Text>
                ) : null}
              </View>
            }
          />
        </>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return user ? <InvoiceHome /> : <LoginScreen />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loader: { flex: 1 },
  loginContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 },
  brandMark: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: 'Inter_700Bold', fontSize: 32, marginTop: 18 },
  loginSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 15, marginTop: 4, marginBottom: 28 },
  loginCard: { borderWidth: 1, padding: 20, borderRadius: 12 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: 8 },
  input: { height: 50, borderWidth: 1, borderRadius: 6, paddingHorizontal: 14, marginBottom: 18, fontFamily: 'Inter_400Regular', fontSize: 16 },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  primaryButton: { height: 52, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.4 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 27, marginTop: 2 },
  searchBox: { marginHorizontal: 20, height: 48, borderWidth: 1, borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  searchInput: { flex: 1, marginLeft: 10, fontFamily: 'Inter_400Regular', fontSize: 15 },
  resultCount: { marginHorizontal: 20, marginTop: 14, marginBottom: 8, fontFamily: 'Inter_500Medium', fontSize: 12 },
  listContent: { paddingHorizontal: 20, paddingBottom: 110 },
  invoiceRow: { minHeight: 76, borderWidth: 1, borderRadius: 8, marginBottom: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  invoiceCopy: { flex: 1 },
  invoiceNumber: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  customerName: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 5 },
  invoiceAmount: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowAmount: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 28 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17, marginTop: 14 },
  detailContent: { paddingHorizontal: 20, paddingBottom: 110 },
  backButton: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  backText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  detailHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 18 },
  detailTitle: { fontFamily: 'Inter_700Bold', fontSize: 25, marginTop: 3 },
  statusPill: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20 },
  statusText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textTransform: 'capitalize' },
  balanceCard: { borderRadius: 10, padding: 20, marginBottom: 14 },
  balanceLabel: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.2 },
  balanceAmount: { fontFamily: 'Inter_700Bold', fontSize: 36, marginTop: 8 },
  balanceMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 6 },
  paymentCard: { borderWidth: 1, borderRadius: 10, padding: 18 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 16 },
  amountInputRow: { height: 54, borderWidth: 1, borderRadius: 6, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  currency: { fontFamily: 'Inter_600SemiBold', fontSize: 20 },
  amountInput: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 21, paddingLeft: 5 },
  takePaymentButton: { height: 56, borderRadius: 7, marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  takePaymentText: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  notice: { marginTop: 12, borderRadius: 6, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  noticeText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 18 },
  historyTitle: { marginTop: 25, marginBottom: 5 },
  historyRow: { minHeight: 66, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center' },
  historyIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  historyCopy: { flex: 1, marginLeft: 11 },
  historyMethod: { fontFamily: 'Inter_600SemiBold', fontSize: 14, textTransform: 'capitalize' },
  historyStatus: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  historyAmount: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  emptyHistory: { fontFamily: 'Inter_400Regular', fontSize: 14, paddingVertical: 18 },
});