/**
 * Buy Credits — picks an amount + method (UPI Direct or Razorpay).
 * UPI Direct flow:  generate intent → show QR + open-link → user pays → submit UTR
 * Razorpay flow:     create order → open WebView checkout → verify signature → credits added
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import { WebView } from "react-native-webview";
import { useAuth } from "@/src/auth";
import { C, FONT, FS, SP } from "@/src/theme";

type Plan = { id: string; label: string; amount_inr: number; credits: number; description: string };

type Method = "upi" | "razorpay";

type UpiIntent = {
  payment_id: string;
  amount_inr: number;
  credits: number;
  upi_uri: string;
  upi_id: string;
  merchant_name: string;
  note: string;
};

type RzpOrder = {
  payment_id: string;
  rzp_order_id: string;
  rzp_key_id: string;
  amount_inr: number;
  amount_paise: number;
  merchant_name: string;
  user_email: string;
  user_name: string;
};

export default function BuyCredits() {
  const { authFetch, user } = useAuth();
  const insets = useSafeAreaInsets();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [razorpayEnabled, setRazorpayEnabled] = useState(false);
  const [upiEnabled, setUpiEnabled] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string>("monthly");
  const [customAmount, setCustomAmount] = useState<string>("");
  const [method, setMethod] = useState<Method>("upi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [upiSheet, setUpiSheet] = useState<UpiIntent | null>(null);
  const [rzpOrder, setRzpOrder] = useState<RzpOrder | null>(null);

  useEffect(() => {
    (async () => {
      const r = await authFetch("/api/wallet");
      const data = await r.json();
      setPlans(data.plans || []);
      setRazorpayEnabled(!!data.razorpay_enabled);
      setUpiEnabled(!!data.upi_enabled);
      if (!data.razorpay_enabled) setMethod("upi");
    })();
  }, [authFetch]);

  const finalAmount = useMemo(() => {
    if (selectedPlan === "custom") return parseInt(customAmount, 10) || 0;
    const p = plans.find((pp) => pp.id === selectedPlan);
    return p?.amount_inr || 0;
  }, [selectedPlan, customAmount, plans]);

  const startPayment = useCallback(async () => {
    setError(null);
    if (finalAmount < 1) {
      setError("ENTER A VALID AMOUNT");
      return;
    }
    setBusy(true);
    try {
      if (method === "upi") {
        const r = await authFetch("/api/payments/upi/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount_inr: finalAmount }),
        });
        if (!r.ok) throw new Error(`UPI intent failed: ${r.status}`);
        const data: UpiIntent = await r.json();
        setUpiSheet(data);
      } else {
        const r = await authFetch("/api/payments/razorpay/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount_inr: finalAmount }),
        });
        if (!r.ok) {
          const t = await r.text();
          throw new Error(`Razorpay order failed: ${t.slice(0, 120)}`);
        }
        const data: RzpOrder = await r.json();
        setRzpOrder(data);
      }
    } catch (e: any) {
      setError(e?.message || "Payment failed");
    } finally {
      setBusy(false);
    }
  }, [finalAmount, method, authFetch]);

  return (
    <SafeAreaView style={s.root} edges={["top"]} testID="buy-credits-screen">
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
          <Text style={s.metaTop}>{"// PURCHASE"}</Text>
          <Text style={s.title}>BUY CREDITS</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: SP.lg, paddingBottom: insets.bottom + 140 }}>
        <Text style={s.label}>{"// CHOOSE PLAN"}</Text>
        {plans.map((p) => {
          const active = p.id === selectedPlan;
          return (
            <Pressable
              key={p.id}
              onPress={() => setSelectedPlan(p.id)}
              style={[s.planRow, active && s.planRowActive]}
              testID={`plan-${p.id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.planLabel, active && s.planLabelActive]}>{p.label}</Text>
                <Text style={[s.planSub, active && s.planSubActive]}>{p.description}</Text>
              </View>
              <View style={[s.planAmount, active && s.planAmountActive]}>
                <Text style={[s.planAmountText, active && s.planAmountTextActive]}>
                  ₹{p.amount_inr}
                </Text>
              </View>
            </Pressable>
          );
        })}

        {/* Custom amount */}
        <Pressable
          onPress={() => setSelectedPlan("custom")}
          style={[s.planRow, selectedPlan === "custom" && s.planRowActive]}
          testID="plan-custom"
        >
          <View style={{ flex: 1 }}>
            <Text style={[s.planLabel, selectedPlan === "custom" && s.planLabelActive]}>
              CUSTOM TOP-UP
            </Text>
            <Text style={[s.planSub, selectedPlan === "custom" && s.planSubActive]}>
              ₹X = X CREDITS · min ₹1
            </Text>
          </View>
          <TextInput
            value={customAmount}
            onChangeText={(t) => {
              setCustomAmount(t.replace(/[^0-9]/g, ""));
              setSelectedPlan("custom");
            }}
            placeholder="100"
            placeholderTextColor={C.onSurfaceTertiary}
            keyboardType="number-pad"
            style={[s.customInput, selectedPlan === "custom" && { borderColor: C.onSurfaceInverse, color: C.onSurfaceInverse }]}
            testID="custom-amount-input"
          />
        </Pressable>

        {/* Method picker */}
        <Text style={[s.label, { marginTop: SP.xl }]}>{"// PAYMENT METHOD"}</Text>
        <View style={s.methodGrid}>
          <Pressable
            onPress={() => setMethod("upi")}
            disabled={!upiEnabled}
            style={[s.methodCell, method === "upi" && s.methodCellActive, !upiEnabled && { opacity: 0.4 }]}
            testID="method-upi"
          >
            <Feather name="smartphone" size={28} color={method === "upi" ? C.onSurfaceInverse : C.onSurface} />
            <Text style={[s.methodLabel, method === "upi" && s.methodLabelActive]}>UPI DIRECT</Text>
            <Text style={[s.methodSub, method === "upi" && s.methodSubActive]}>
              QR · MANUAL UTR
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMethod("razorpay")}
            disabled={!razorpayEnabled}
            style={[s.methodCell, method === "razorpay" && s.methodCellActive, !razorpayEnabled && { opacity: 0.4 }]}
            testID="method-razorpay"
          >
            <Feather name="credit-card" size={28} color={method === "razorpay" ? C.onSurfaceInverse : C.onSurface} />
            <Text style={[s.methodLabel, method === "razorpay" && s.methodLabelActive]}>RAZORPAY</Text>
            <Text style={[s.methodSub, method === "razorpay" && s.methodSubActive]}>
              {razorpayEnabled ? "AUTO-VERIFY" : "NOT CONFIGURED"}
            </Text>
          </Pressable>
        </View>

        {/* Summary */}
        <View style={s.summary}>
          <Text style={s.summaryLabel}>YOU PAY</Text>
          <Text style={s.summaryAmount}>₹{finalAmount}</Text>
          <Text style={s.summaryCredits}>= {finalAmount} CREDITS</Text>
        </View>

        {error && (
          <View style={s.errorBlock}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        <Pressable
          onPress={startPayment}
          disabled={busy || finalAmount < 1}
          style={[s.payBtn, (busy || finalAmount < 1) && s.payBtnDisabled]}
          testID="proceed-payment-button"
        >
          {busy ? (
            <ActivityIndicator color={C.onSurfaceInverse} />
          ) : (
            <Text style={s.payBtnText}>PROCEED  →  ₹{finalAmount}</Text>
          )}
        </Pressable>
      </View>

      {/* === UPI sheet === */}
      <UpiSheetModal
        intent={upiSheet}
        onClose={() => setUpiSheet(null)}
        onCompleted={() => {
          setUpiSheet(null);
          router.replace("/wallet");
        }}
      />

      {/* === Razorpay WebView checkout === */}
      <RazorpayCheckoutModal
        order={rzpOrder}
        onClose={() => setRzpOrder(null)}
        onSuccess={() => {
          setRzpOrder(null);
          router.replace("/wallet");
        }}
      />
    </SafeAreaView>
  );
}

// ---------------- UPI Sheet ----------------
function UpiSheetModal({
  intent,
  onClose,
  onCompleted,
}: {
  intent: UpiIntent | null;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const { authFetch } = useAuth();
  const [utr, setUtr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (intent) {
      setUtr("");
      setSubmitted(false);
      setErr(null);
    }
  }, [intent]);

  const openUpi = async () => {
    if (!intent) return;
    try {
      const can = await Linking.canOpenURL(intent.upi_uri);
      if (!can) {
        setErr("NO UPI APP DETECTED ON THIS DEVICE. SCAN THE QR FROM ANOTHER PHONE OR INSTALL GPAY/PHONEPE.");
        return;
      }
      await Linking.openURL(intent.upi_uri);
    } catch {
      setErr("FAILED TO OPEN UPI APP");
    }
  };

  const submitUtr = async () => {
    if (!intent) return;
    if (utr.trim().length < 6) {
      setErr("UTR MUST BE AT LEAST 6 CHARACTERS");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const r = await authFetch("/api/payments/upi/submit-utr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_id: intent.payment_id, utr: utr.trim() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSubmitted(true);
    } catch (e: any) {
      setErr(e?.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const copyVpa = () => {
    if (intent) Clipboard.setStringAsync(intent.upi_id);
  };

  return (
    <Modal visible={!!intent} animationType="slide" onRequestClose={onClose}>
      {intent && (
        <SafeAreaView style={s2.root} edges={["top", "bottom"]}>
          <View style={s2.header}>
            <Pressable onPress={onClose} style={s2.closeBtn} testID="upi-close" hitSlop={12}>
              <Feather name="x" size={20} color={C.onSurface} />
            </Pressable>
            <Text style={s2.headerTitle}>UPI DIRECT</Text>
          </View>

          <ScrollView contentContainerStyle={{ padding: SP.lg }}>
            {submitted ? (
              <View style={s2.successBlock}>
                <View style={s2.checkBox}>
                  <Feather name="check" size={48} color={C.onSurfaceInverse} />
                </View>
                <Text style={s2.successTitle}>UTR SUBMITTED</Text>
                <Text style={s2.successBody}>
                  YOUR PAYMENT IS UNDER MANUAL REVIEW. CREDITS WILL BE ADDED ONCE THE MERCHANT
                  VERIFIES THE TRANSACTION IN THEIR BANK STATEMENT.
                </Text>
                <Pressable
                  onPress={onCompleted}
                  style={s2.successBtn}
                  testID="upi-done-button"
                >
                  <Text style={s2.successBtnText}>BACK TO WALLET</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={s2.amountHead}>
                  <Text style={s2.amountLabel}>AMOUNT</Text>
                  <Text style={s2.amountNum}>₹{intent.amount_inr}</Text>
                  <Text style={s2.amountCr}>{intent.credits} CREDITS</Text>
                </View>

                <View style={s2.qrCard}>
                  <View style={{ alignItems: "center", padding: SP.md, backgroundColor: "#fff" }}>
                    <QRCode value={intent.upi_uri} size={220} backgroundColor="#fff" color="#000" />
                  </View>
                  <View style={s2.qrMeta}>
                    <Text style={s2.qrCaption}>SCAN WITH ANY UPI APP</Text>
                  </View>
                </View>

                <View style={s2.vpaRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s2.vpaLabel}>UPI ID</Text>
                    <Text style={s2.vpaValue} testID="upi-vpa-text">{intent.upi_id}</Text>
                  </View>
                  <Pressable onPress={copyVpa} style={s2.copyBtn} testID="upi-copy-vpa">
                    <Feather name="copy" size={16} color={C.onSurfaceInverse} />
                    <Text style={s2.copyBtnText}>COPY</Text>
                  </Pressable>
                </View>

                <Pressable onPress={openUpi} style={s2.openBtn} testID="upi-open-app-button">
                  <Feather name="external-link" size={18} color={C.onSurfaceInverse} />
                  <Text style={s2.openBtnText}>OPEN UPI APP</Text>
                </Pressable>

                <View style={s2.divider} />

                <Text style={s2.utrTitle}>STEP 2 // ENTER UTR</Text>
                <Text style={s2.utrHint}>
                  AFTER PAYING, FIND THE 12-DIGIT UPI REFERENCE NUMBER (UTR) IN YOUR PAYMENT APP
                  AND PASTE IT BELOW. CREDITS ADD AFTER MERCHANT VERIFICATION.
                </Text>
                <TextInput
                  value={utr}
                  onChangeText={(t) => setUtr(t.replace(/[^a-zA-Z0-9]/g, ""))}
                  placeholder="123456789012"
                  placeholderTextColor={C.onSurfaceTertiary}
                  style={s2.utrInput}
                  autoCapitalize="characters"
                  testID="utr-input"
                />
                {err && <Text style={s2.errText}>{err}</Text>}
                <Pressable
                  onPress={submitUtr}
                  disabled={submitting}
                  style={[s2.submitBtn, submitting && { opacity: 0.5 }]}
                  testID="utr-submit-button"
                >
                  {submitting ? (
                    <ActivityIndicator color={C.onSurfaceInverse} />
                  ) : (
                    <Text style={s2.submitBtnText}>SUBMIT FOR REVIEW</Text>
                  )}
                </Pressable>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      )}
    </Modal>
  );
}

// ---------------- Razorpay Checkout Modal ----------------
function RazorpayCheckoutModal({
  order,
  onClose,
  onSuccess,
}: {
  order: RzpOrder | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { authFetch } = useAuth();
  const [verifying, setVerifying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const html = useMemo(() => {
    if (!order) return "";
    // SEC: prevent </script> breakout when injecting JS string literals.
    const safe = (v: string) =>
      JSON.stringify(v ?? "").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    return `<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>html,body{margin:0;padding:0;background:#fff;font-family:system-ui;height:100%;display:flex;align-items:center;justify-content:center;color:#111}.box{padding:32px;text-align:center}</style></head><body>
<div class='box'><p>Loading checkout...</p></div>
<script src='https://checkout.razorpay.com/v1/checkout.js'></script>
<script>
  const opts = {
    key: ${safe(order.rzp_key_id)},
    amount: ${order.amount_paise},
    currency: 'INR',
    name: ${safe(order.merchant_name)},
    description: 'LEO AI Credits',
    order_id: ${safe(order.rzp_order_id)},
    prefill: { name: ${safe(order.user_name)}, email: ${safe(order.user_email)} },
    theme: { color: '#FF2A00' },
    handler: function(res) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'success', ...res }));
    },
    modal: {
      ondismiss: function() {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'dismiss' }));
      }
    }
  };
  const rzp = new Razorpay(opts);
  rzp.on('payment.failed', function(r) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'failed', error: r.error }));
  });
  setTimeout(function() { rzp.open(); }, 200);
</script>
</body></html>`;
  }, [order]);

  const onMessage = async (evt: any) => {
    if (!order) return;
    try {
      const data = JSON.parse(evt.nativeEvent.data);
      if (data.type === "dismiss") {
        onClose();
        return;
      }
      if (data.type === "failed") {
        setErr(data?.error?.description || "Payment failed");
        return;
      }
      if (data.type === "success") {
        setVerifying(true);
        const r = await authFetch("/api/payments/razorpay/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment_id: order.payment_id,
            rzp_order_id: data.razorpay_order_id,
            rzp_payment_id: data.razorpay_payment_id,
            rzp_signature: data.razorpay_signature,
          }),
        });
        if (!r.ok) {
          const t = await r.text();
          throw new Error(`Verify failed: ${t.slice(0, 120)}`);
        }
        onSuccess();
      }
    } catch (e: any) {
      setErr(e?.message || "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Modal visible={!!order} animationType="slide" onRequestClose={onClose}>
      {order && (
        <SafeAreaView style={s2.root} edges={["top", "bottom"]}>
          <View style={s2.header}>
            <Pressable onPress={onClose} style={s2.closeBtn} testID="rzp-close" hitSlop={12}>
              <Feather name="x" size={20} color={C.onSurface} />
            </Pressable>
            <Text style={s2.headerTitle}>RAZORPAY</Text>
          </View>
          {verifying ? (
            <View style={[s2.root, { alignItems: "center", justifyContent: "center" }]}>
              <ActivityIndicator size="large" color={C.brand} />
              <Text style={[s2.mono, { marginTop: SP.md }]}>VERIFYING PAYMENT…</Text>
            </View>
          ) : (
            <>
              {Platform.OS !== "web" ? (
                <WebView
                  originWhitelist={["*"]}
                  source={{ html, baseUrl: "https://leo.local" }}
                  javaScriptEnabled
                  onMessage={onMessage}
                  style={{ flex: 1 }}
                />
              ) : (
                <View style={[s2.root, { alignItems: "center", justifyContent: "center", padding: SP.lg }]}>
                  <Text style={s2.mono}>
                    Razorpay Checkout opens on the mobile app. Use the Expo Go app to complete payment.
                  </Text>
                </View>
              )}
              {err && (
                <View style={{ padding: SP.lg }}>
                  <Text style={s2.errText}>{err}</Text>
                </View>
              )}
            </>
          )}
        </SafeAreaView>
      )}
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
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
  label: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 1.5, marginBottom: SP.sm },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderColor: C.borderStrong,
    padding: SP.md,
    marginBottom: SP.sm,
    backgroundColor: C.surface,
  },
  planRowActive: { backgroundColor: C.surfaceInverse },
  planLabel: { fontFamily: FONT.display, fontSize: FS.xl, fontWeight: "900", color: C.onSurface, letterSpacing: -0.3 },
  planLabelActive: { color: C.onSurfaceInverse },
  planSub: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, marginTop: 2 },
  planSubActive: { color: "#cccccc" },
  planAmount: { borderWidth: 2, borderColor: C.borderStrong, paddingHorizontal: SP.md, paddingVertical: 6 },
  planAmountActive: { borderColor: C.brand, backgroundColor: C.brand },
  planAmountText: { fontFamily: FONT.mono, fontSize: FS.lg, fontWeight: "700", color: C.onSurface, letterSpacing: 0.5 },
  planAmountTextActive: { color: C.onSurfaceInverse },
  customInput: {
    width: 96,
    height: 44,
    borderWidth: 2,
    borderColor: C.borderStrong,
    paddingHorizontal: SP.sm,
    textAlign: "center",
    fontFamily: FONT.mono,
    fontSize: FS.lg,
    color: C.onSurface,
  },
  methodGrid: { flexDirection: "row", gap: SP.sm },
  methodCell: {
    flex: 1,
    borderWidth: 2,
    borderColor: C.borderStrong,
    padding: SP.lg,
    alignItems: "center",
    backgroundColor: C.surface,
  },
  methodCellActive: { backgroundColor: C.surfaceInverse, borderColor: C.surfaceInverse },
  methodLabel: { fontFamily: FONT.mono, fontSize: FS.base, color: C.onSurface, letterSpacing: 1, fontWeight: "700", marginTop: SP.sm },
  methodLabelActive: { color: C.onSurfaceInverse },
  methodSub: { fontFamily: FONT.mono, fontSize: 10, color: C.onSurfaceTertiary, marginTop: 4, letterSpacing: 1 },
  methodSubActive: { color: "#cccccc" },
  summary: {
    marginTop: SP.xl,
    borderWidth: 2,
    borderColor: C.borderStrong,
    padding: SP.lg,
    alignItems: "center",
    backgroundColor: C.surfaceSecondary,
  },
  summaryLabel: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 2 },
  summaryAmount: {
    fontFamily: FONT.display,
    fontSize: 64,
    fontWeight: "900",
    color: C.onSurface,
    letterSpacing: -2,
    marginTop: SP.sm,
  },
  summaryCredits: { fontFamily: FONT.mono, fontSize: FS.lg, color: C.brand, letterSpacing: 2, fontWeight: "700" },
  errorBlock: { marginTop: SP.md, borderWidth: 2, borderColor: C.brand, padding: SP.md, backgroundColor: "#FFF5F2" },
  errorText: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.brand, letterSpacing: 1 },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.surface,
    borderTopWidth: 2,
    borderColor: C.borderStrong,
    paddingHorizontal: SP.lg,
    paddingTop: SP.md,
  },
  payBtn: { backgroundColor: C.brand, paddingVertical: SP.lg, alignItems: "center" },
  payBtnDisabled: { opacity: 0.5 },
  payBtnText: { fontFamily: FONT.mono, fontSize: FS.lg, color: C.onSurfaceInverse, letterSpacing: 2, fontWeight: "700" },
});

const s2 = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SP.lg,
    paddingVertical: SP.md,
    borderBottomWidth: 2,
    borderColor: C.borderStrong,
  },
  closeBtn: {
    width: 36, height: 36, borderWidth: 2, borderColor: C.borderStrong,
    alignItems: "center", justifyContent: "center", marginRight: SP.md,
  },
  headerTitle: { fontFamily: FONT.display, fontSize: FS["2xl"], fontWeight: "900", color: C.onSurface, letterSpacing: -0.5 },
  amountHead: { alignItems: "center", marginBottom: SP.lg },
  amountLabel: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 2 },
  amountNum: {
    fontFamily: FONT.display,
    fontSize: 64,
    fontWeight: "900",
    color: C.onSurface,
    letterSpacing: -2,
    marginTop: SP.xs,
  },
  amountCr: { fontFamily: FONT.mono, fontSize: FS.base, color: C.brand, letterSpacing: 2, fontWeight: "700" },
  qrCard: { alignItems: "center", borderWidth: 2, borderColor: C.borderStrong, backgroundColor: "#fff" },
  qrMeta: { paddingVertical: SP.sm, alignItems: "center", borderTopWidth: 2, borderColor: C.borderStrong, width: "100%", backgroundColor: C.surfaceInverse },
  qrCaption: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceInverse, letterSpacing: 2 },
  vpaRow: { flexDirection: "row", alignItems: "center", marginTop: SP.lg, borderWidth: 2, borderColor: C.borderStrong, padding: SP.md, backgroundColor: C.surfaceSecondary },
  vpaLabel: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 1 },
  vpaValue: { fontFamily: FONT.mono, fontSize: FS.base, color: C.onSurface, marginTop: 2, fontWeight: "700" },
  copyBtn: { backgroundColor: C.surfaceInverse, paddingHorizontal: SP.md, paddingVertical: SP.sm, flexDirection: "row", alignItems: "center", gap: 6 },
  copyBtnText: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceInverse, fontWeight: "700", letterSpacing: 1 },
  openBtn: {
    marginTop: SP.md,
    backgroundColor: C.brand,
    paddingVertical: SP.lg,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: SP.sm,
  },
  openBtnText: { fontFamily: FONT.mono, fontSize: FS.lg, color: C.onSurfaceInverse, letterSpacing: 2, fontWeight: "700" },
  divider: { height: 2, backgroundColor: C.borderStrong, marginVertical: SP.xl },
  utrTitle: { fontFamily: FONT.mono, fontSize: FS.lg, color: C.onSurface, letterSpacing: 1.5, fontWeight: "700" },
  utrHint: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 0.5, lineHeight: 18, marginTop: SP.sm },
  utrInput: {
    marginTop: SP.md,
    borderWidth: 2,
    borderColor: C.borderStrong,
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    fontFamily: FONT.mono,
    fontSize: FS.lg,
    color: C.onSurface,
    letterSpacing: 2,
  },
  errText: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.brand, marginTop: SP.sm, letterSpacing: 1 },
  submitBtn: { marginTop: SP.md, backgroundColor: C.surfaceInverse, paddingVertical: SP.lg, alignItems: "center" },
  submitBtnText: { fontFamily: FONT.mono, fontSize: FS.lg, color: C.onSurfaceInverse, letterSpacing: 2, fontWeight: "700" },
  successBlock: { alignItems: "center", padding: SP.lg },
  checkBox: {
    width: 88, height: 88, backgroundColor: C.success,
    alignItems: "center", justifyContent: "center", marginBottom: SP.lg,
  },
  successTitle: { fontFamily: FONT.display, fontSize: FS["3xl"], fontWeight: "900", color: C.onSurface, letterSpacing: -1 },
  successBody: {
    fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary,
    letterSpacing: 0.5, lineHeight: 20, textAlign: "center", marginTop: SP.md,
  },
  successBtn: { marginTop: SP.xl, backgroundColor: C.brand, paddingHorizontal: SP.xl, paddingVertical: SP.lg },
  successBtnText: { fontFamily: FONT.mono, fontSize: FS.lg, color: C.onSurfaceInverse, letterSpacing: 2, fontWeight: "700" },
  mono: { fontFamily: FONT.mono, fontSize: FS.base, color: C.onSurface, letterSpacing: 1 },
});
