/**
 * Wallet — shows credit balance, recent payments, and "BUY CREDITS" entry.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { C, FONT, FS, SP } from "@/src/theme";

type Payment = {
  payment_id: string;
  method: "upi_intent" | "razorpay";
  amount_inr: number;
  credits: number;
  status: "pending" | "utr_submitted" | "approved" | "rejected";
  utr?: string | null;
  created_at: string;
};

type WalletInfo = {
  credits: number;
  is_admin: boolean;
  plans: { id: string; label: string; amount_inr: number; credits: number; description: string }[];
  rate: { credits_per_inr: number };
  razorpay_enabled: boolean;
  upi_enabled: boolean;
};

export default function Wallet() {
  const { authFetch } = useAuth();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [wr, pr] = await Promise.all([
          authFetch("/api/wallet"),
          authFetch("/api/payments/me"),
        ]);
        const w = await wr.json();
        const p = await pr.json();
        setInfo(w);
        setPayments(p.items || []);
      } catch {}
      setLoading(false);
      setRefreshing(false);
    },
    [authFetch]
  );

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={[s.root, s.center]} edges={["top"]}>
        <ActivityIndicator size="large" color={C.brand} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={["top"]} testID="wallet-screen">
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          style={s.backBtn}
          testID="back-button"
          hitSlop={12}
        >
          <Feather name="arrow-left" size={20} color={C.onSurface} />
        </Pressable>
        <View style={{ flex: 1, paddingHorizontal: SP.md }}>
          <Text style={s.metaTop}>{"// WALLET"}</Text>
          <Text style={s.title}>CREDITS</Text>
        </View>
        {info?.is_admin && (
          <Pressable
            onPress={() => router.push("/admin/payments")}
            style={s.adminBtn}
            testID="admin-button"
          >
            <Feather name="shield" size={16} color={C.onSurfaceInverse} />
            <Text style={s.adminBtnText}>ADMIN</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(true);
            }}
            tintColor={C.brand}
          />
        }
      >
        {/* Balance hero */}
        <View style={s.balanceBlock}>
          <Text style={s.balanceLabel}>BALANCE</Text>
          <Text style={s.balanceNumber} testID="credit-balance">{info?.credits ?? 0}</Text>
          <Text style={s.balanceUnit}>CREDITS</Text>
          <View style={s.balanceBar} />
          <Text style={s.balanceSub}>
            1 GENERATION = 1 CREDIT · 1 ₹ = 1 CREDIT
          </Text>
        </View>

        {/* Buy CTA */}
        <Pressable
          onPress={() => router.push("/wallet/buy")}
          style={s.buyBtn}
          testID="buy-credits-button"
        >
          <Text style={s.buyBtnText}>+ BUY CREDITS</Text>
        </Pressable>

        {/* Payment history */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>{"// RECENT PAYMENTS"}</Text>
          {payments.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={s.mono}>NO PAYMENTS YET</Text>
              <Text style={[s.mono, { color: C.onSurfaceTertiary, marginTop: 4 }]}>
                BUY CREDITS TO GET STARTED.
              </Text>
            </View>
          ) : (
            payments.map((p) => (
              <View key={p.payment_id} style={s.paymentRow} testID={`payment-row-${p.payment_id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={s.paymentTitle}>
                    ₹{p.amount_inr} · {p.credits} CR
                  </Text>
                  <Text style={s.paymentMeta}>
                    {(p.method === "razorpay" ? "RAZORPAY" : "UPI DIRECT")} ·{" "}
                    {new Date(p.created_at).toLocaleDateString()}{" "}
                    {p.utr ? `· UTR ${p.utr}` : ""}
                  </Text>
                </View>
                <View style={[s.statusPill, statusStyle(p.status)]}>
                  <Text style={[s.statusText, statusTextStyle(p.status)]}>
                    {statusLabel(p.status)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function statusLabel(st: Payment["status"]) {
  switch (st) {
    case "approved":
      return "PAID ✓";
    case "utr_submitted":
      return "REVIEW";
    case "rejected":
      return "REJECTED";
    default:
      return "PENDING";
  }
}
function statusStyle(st: Payment["status"]) {
  if (st === "approved") return { backgroundColor: C.success, borderColor: C.success };
  if (st === "rejected") return { backgroundColor: C.brand, borderColor: C.brand };
  if (st === "utr_submitted") return { backgroundColor: C.warning, borderColor: C.warning };
  return { backgroundColor: C.surface, borderColor: C.borderStrong };
}
function statusTextStyle(st: Payment["status"]) {
  if (st === "approved" || st === "rejected" || st === "utr_submitted")
    return { color: "#FFFFFF" };
  return { color: C.onSurface };
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SP.lg,
    paddingVertical: SP.md,
    borderBottomWidth: 2,
    borderColor: C.borderStrong,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderWidth: 2,
    borderColor: C.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  adminBtn: {
    backgroundColor: C.surfaceInverse,
    paddingHorizontal: SP.md,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  adminBtnText: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceInverse, letterSpacing: 1, fontWeight: "700" },
  metaTop: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 1 },
  title: { fontFamily: FONT.display, fontSize: FS["2xl"], fontWeight: "900", color: C.onSurface, letterSpacing: -0.5 },
  balanceBlock: {
    margin: SP.lg,
    borderWidth: 2,
    borderColor: C.borderStrong,
    padding: SP.lg,
    backgroundColor: C.surfaceInverse,
  },
  balanceLabel: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceInverse, letterSpacing: 2, opacity: 0.7 },
  balanceNumber: {
    fontFamily: FONT.display,
    fontSize: 96,
    fontWeight: "900",
    color: C.onSurfaceInverse,
    letterSpacing: -4,
    lineHeight: 96,
    marginTop: SP.sm,
  },
  balanceUnit: { fontFamily: FONT.mono, fontSize: FS.lg, color: C.brand, letterSpacing: 4, marginTop: 2 },
  balanceBar: { width: 60, height: 4, backgroundColor: C.brand, marginTop: SP.md },
  balanceSub: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceInverse, opacity: 0.7, marginTop: SP.md, letterSpacing: 1 },
  buyBtn: {
    marginHorizontal: SP.lg,
    marginBottom: SP.lg,
    backgroundColor: C.brand,
    paddingVertical: SP.lg,
    alignItems: "center",
  },
  buyBtnText: { fontFamily: FONT.mono, fontSize: FS.lg, color: C.onSurfaceInverse, letterSpacing: 2, fontWeight: "700" },
  section: { paddingHorizontal: SP.lg, marginTop: SP.md },
  sectionLabel: {
    fontFamily: FONT.mono,
    fontSize: FS.sm,
    color: C.onSurfaceTertiary,
    letterSpacing: 1.5,
    marginBottom: SP.sm,
  },
  emptyBox: {
    borderWidth: 2,
    borderColor: C.borderStrong,
    padding: SP.lg,
    backgroundColor: C.surfaceSecondary,
  },
  paymentRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderColor: C.borderStrong,
    padding: SP.md,
    marginBottom: SP.sm,
    backgroundColor: C.surface,
  },
  paymentTitle: { fontFamily: FONT.display, fontSize: FS.lg, fontWeight: "900", color: C.onSurface },
  paymentMeta: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, marginTop: 2, letterSpacing: 0.5 },
  statusPill: {
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
    borderWidth: 2,
  },
  statusText: { fontFamily: FONT.mono, fontSize: FS.sm, fontWeight: "700", letterSpacing: 1 },
  mono: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurface, letterSpacing: 1 },
});
