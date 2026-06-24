/**
 * Admin: Approve / Reject pending UPI payments (manual UTR verification).
 * Only visible to users with is_admin=true (the first registered user).
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

type PendingPayment = {
  payment_id: string;
  user_email: string;
  user_id: string;
  amount_inr: number;
  credits: number;
  method: string;
  status: string;
  utr?: string | null;
  created_at: string;
};

export default function AdminPayments() {
  const { authFetch } = useAuth();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<PendingPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setErr(null);
      try {
        const r = await authFetch("/api/admin/payments/pending");
        if (r.status === 403) {
          setErr("ADMIN ACCESS REQUIRED");
          setItems([]);
        } else {
          const data = await r.json();
          setItems(data.items || []);
        }
      } catch {
        setErr("FAILED TO LOAD");
      }
      setLoading(false);
      setRefreshing(false);
    },
    [authFetch]
  );

  useEffect(() => {
    load();
  }, [load]);

  const act = async (paymentId: string, action: "approve" | "reject") => {
    setActing(paymentId);
    try {
      await authFetch(`/api/admin/payments/${paymentId}/${action}`, { method: "POST" });
      setItems((prev) => prev.filter((p) => p.payment_id !== paymentId));
    } catch {
      setErr("ACTION FAILED");
    } finally {
      setActing(null);
    }
  };

  return (
    <SafeAreaView style={s.root} edges={["top"]} testID="admin-payments-screen">
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
          <Text style={s.metaTop}>{"// ADMIN"}</Text>
          <Text style={s.title}>UPI REVIEW</Text>
        </View>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.brand} />
        </View>
      ) : err ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>{err}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>QUEUE EMPTY</Text>
          <Text style={[s.mono, { color: C.onSurfaceTertiary, marginTop: SP.sm }]}>
            NO PAYMENTS PENDING REVIEW.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: SP.lg, paddingBottom: insets.bottom + SP.xl }}
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
          {items.map((p) => (
            <View key={p.payment_id} style={s.card} testID={`admin-card-${p.payment_id}`}>
              <View style={s.cardHead}>
                <Text style={s.amount}>₹{p.amount_inr}</Text>
                <Text style={s.creditsLine}>= {p.credits} CR</Text>
              </View>
              <View style={s.meta}>
                <Text style={s.metaRow}>
                  USER · <Text style={s.metaVal}>{p.user_email}</Text>
                </Text>
                <Text style={s.metaRow}>
                  UTR · <Text style={s.metaVal}>{p.utr || "—"}</Text>
                </Text>
                <Text style={s.metaRow}>
                  STATUS · <Text style={s.metaVal}>{p.status.toUpperCase()}</Text>
                </Text>
                <Text style={s.metaRow}>
                  WHEN · <Text style={s.metaVal}>{new Date(p.created_at).toLocaleString()}</Text>
                </Text>
                <Text style={s.metaRow}>
                  ID · <Text style={s.metaVal}>{p.payment_id}</Text>
                </Text>
              </View>
              <View style={s.actions}>
                <Pressable
                  onPress={() => act(p.payment_id, "reject")}
                  disabled={acting === p.payment_id}
                  style={s.rejectBtn}
                  testID={`reject-${p.payment_id}`}
                >
                  {acting === p.payment_id ? (
                    <ActivityIndicator color={C.onSurface} />
                  ) : (
                    <Text style={s.rejectText}>REJECT</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => act(p.payment_id, "approve")}
                  disabled={acting === p.payment_id}
                  style={s.approveBtn}
                  testID={`approve-${p.payment_id}`}
                >
                  {acting === p.payment_id ? (
                    <ActivityIndicator color={C.onSurfaceInverse} />
                  ) : (
                    <Text style={s.approveText}>APPROVE & CREDIT</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SP.xl },
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
  metaTop: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 1 },
  title: { fontFamily: FONT.display, fontSize: FS["2xl"], fontWeight: "900", color: C.onSurface, letterSpacing: -0.5 },
  emptyTitle: { fontFamily: FONT.display, fontSize: FS["2xl"], fontWeight: "900", color: C.onSurface, letterSpacing: -0.5 },
  mono: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurface },
  card: {
    borderWidth: 2,
    borderColor: C.borderStrong,
    marginBottom: SP.md,
    backgroundColor: C.surface,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: SP.md,
    padding: SP.md,
    backgroundColor: C.surfaceInverse,
  },
  amount: { fontFamily: FONT.display, fontSize: FS["3xl"], fontWeight: "900", color: C.onSurfaceInverse, letterSpacing: -1 },
  creditsLine: { fontFamily: FONT.mono, fontSize: FS.base, color: C.brand, letterSpacing: 2, fontWeight: "700" },
  meta: { padding: SP.md, gap: 4 },
  metaRow: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 1 },
  metaVal: { color: C.onSurface, fontWeight: "700" },
  actions: { flexDirection: "row", borderTopWidth: 2, borderColor: C.borderStrong },
  rejectBtn: { flex: 1, paddingVertical: SP.lg, alignItems: "center", borderRightWidth: 2, borderColor: C.borderStrong, backgroundColor: C.surface },
  rejectText: { fontFamily: FONT.mono, fontSize: FS.base, color: C.onSurface, letterSpacing: 2, fontWeight: "700" },
  approveBtn: { flex: 2, paddingVertical: SP.lg, alignItems: "center", backgroundColor: C.brand },
  approveText: { fontFamily: FONT.mono, fontSize: FS.base, color: C.onSurfaceInverse, letterSpacing: 2, fontWeight: "700" },
});
