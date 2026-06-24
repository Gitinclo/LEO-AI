/**
 * Login Screen — Emergent Google Auth entry point.
 */
import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { C, FONT, FS, SP } from "@/src/theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
    setBusy(true);
    try {
      await login();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.brandBlock}>
          <Text style={s.codeLabel}>LEO.AI / v1.0 / EXPO</Text>
          <Text style={s.brand}>LEO</Text>
          <Text style={s.brand}>STUDIO</Text>
          <View style={s.brandUnderline} />
          <Text style={s.tagline}>
            A GENERATIVE TOOLCHAIN FOR{"\n"}3D · MOTION · AUDIO · TYPE · VECTOR
          </Text>
        </View>

        <View style={s.featureGrid}>
          {[
            ["01", "3D SCENE"],
            ["02", "3D VIDEO"],
            ["03", "TEXT VIDEO"],
            ["04", "3D AUDIO"],
            ["05", "2D ART"],
            ["—", "ARCHIVE"],
          ].map(([code, label]) => (
            <View key={label} style={s.featureCell}>
              <Text style={s.featureCode}>{code}</Text>
              <Text style={s.featureLabel}>{label}</Text>
            </View>
          ))}
        </View>

        <View style={s.spacer} />

        <View style={s.loginBlock}>
          <Text style={s.loginCaption}>{"// AUTH REQUIRED"}</Text>
          <Pressable
            onPress={handleLogin}
            disabled={busy}
            style={[s.loginBtn, busy && { opacity: 0.5 }]}
            testID="google-login-button"
          >
            {busy ? (
              <ActivityIndicator color={C.onSurfaceInverse} />
            ) : (
              <>
                <Feather name="log-in" size={18} color={C.onSurfaceInverse} />
                <Text style={s.loginBtnText}>CONTINUE WITH GOOGLE</Text>
              </>
            )}
          </Pressable>
          <Text style={s.legal}>
            BY CONTINUING YOU AGREE TO STORE YOUR CREATIONS LINKED TO YOUR GOOGLE EMAIL.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  content: { flexGrow: 1, paddingHorizontal: SP.lg, paddingTop: SP.xl, paddingBottom: SP.xl },
  brandBlock: { marginTop: SP.xl },
  codeLabel: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 2 },
  brand: {
    fontFamily: FONT.display,
    fontSize: 88,
    fontWeight: "900",
    color: C.onSurface,
    letterSpacing: -4,
    lineHeight: 88,
  },
  brandUnderline: { marginTop: SP.md, height: 4, backgroundColor: C.brand, width: 120 },
  tagline: {
    fontFamily: FONT.mono,
    fontSize: FS.sm,
    color: C.onSurface,
    letterSpacing: 1.5,
    marginTop: SP.lg,
    lineHeight: 20,
  },
  featureGrid: {
    marginTop: SP.xl,
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderColor: C.borderStrong,
  },
  featureCell: {
    width: "33.33%",
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: C.borderStrong,
    paddingVertical: SP.md,
    paddingHorizontal: SP.sm,
  },
  featureCode: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.brand, letterSpacing: 1 },
  featureLabel: {
    fontFamily: FONT.display,
    fontSize: FS.base,
    fontWeight: "900",
    color: C.onSurface,
    marginTop: 4,
    letterSpacing: -0.3,
  },
  spacer: { flex: 1, minHeight: SP.xl },
  loginBlock: { marginTop: SP.xl },
  loginCaption: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 1 },
  loginBtn: {
    marginTop: SP.md,
    backgroundColor: C.surfaceInverse,
    paddingVertical: SP.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SP.sm,
    borderWidth: 2,
    borderColor: C.borderStrong,
  },
  loginBtnText: {
    fontFamily: FONT.mono,
    fontSize: FS.base,
    color: C.onSurfaceInverse,
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  legal: {
    marginTop: SP.md,
    fontFamily: FONT.mono,
    fontSize: 10,
    color: C.onSurfaceTertiary,
    letterSpacing: 0.5,
    lineHeight: 14,
  },
});
