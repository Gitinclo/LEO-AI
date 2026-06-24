/**
 * Home / Studio Hub — entry to the 5 creation modes + profile + gallery.
 */
import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Image,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { C, FONT, FS, MODES, SP } from "@/src/theme";

export default function Home() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const initials = (user?.name || user?.email || "??")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <SafeAreaView style={s.root} edges={["top"]} testID="home-screen">
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.metaTop}>LEO.AI / v1.0</Text>
            <Text style={s.logoText}>LEO</Text>
            <View style={s.logoBar} />
          </View>
          <Pressable
            onPress={() => router.push("/profile")}
            style={s.avatar}
            testID="profile-button"
          >
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={{ width: 44, height: 44 }} />
            ) : (
              <Text style={s.avatarText}>{initials}</Text>
            )}
          </Pressable>
        </View>

        <View style={s.statusBar}>
          <Text style={s.statusText}>OPERATOR: {(user?.name || "GUEST").toUpperCase()}</Text>
          <Text style={s.statusText}>READY</Text>
        </View>

        {/* MODES GRID */}
        <View style={s.modesWrap}>
          <Text style={s.sectionLabel}>{"// CREATIVE MODES"}</Text>
          {MODES.map((m, i) => (
            <Pressable
              key={m.id}
              onPress={() => router.push(m.route as any)}
              style={s.modeCard}
              testID={`mode-${m.id}-card`}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.modeCode}>{m.code}</Text>
                <Text style={s.modeLabel}>{m.label}</Text>
                <Text style={s.modeSub}>{m.sub.toUpperCase()}</Text>
              </View>
              <View style={s.modeIconBox}>
                <Feather
                  name={
                    m.id === "scene"
                      ? "box"
                      : m.id === "video"
                      ? "film"
                      : m.id === "text_video"
                      ? "type"
                      : m.id === "audio"
                      ? "activity"
                      : "feather"
                  }
                  size={32}
                  color={C.onSurface}
                />
              </View>
            </Pressable>
          ))}
        </View>

        {/* ARCHIVE LINK */}
        <Pressable
          onPress={() => router.push("/gallery")}
          style={s.archiveBtn}
          testID="archive-button"
        >
          <Text style={s.archiveText}>OPEN ARCHIVE ↗</Text>
          <Feather name="grid" size={20} color={C.onSurfaceInverse} />
        </Pressable>

        <View style={s.footer}>
          <Text style={s.footerText}>
            ENGINES: CLAUDE 4.5 · GPT 5.2 · GEMINI 3 PRO
          </Text>
          <Text style={s.footerText}>POWERED BY EMERGENT</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: SP.lg,
    paddingTop: SP.lg,
    paddingBottom: SP.md,
  },
  metaTop: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 2 },
  logoText: {
    fontFamily: FONT.display,
    fontSize: 72,
    fontWeight: "900",
    color: C.onSurface,
    letterSpacing: -4,
    lineHeight: 72,
  },
  logoBar: { width: 80, height: 4, backgroundColor: C.brand, marginTop: SP.sm },
  avatar: {
    width: 48,
    height: 48,
    borderWidth: 2,
    borderColor: C.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surfaceInverse,
    overflow: "hidden",
  },
  avatarText: { fontFamily: FONT.mono, fontSize: FS.base, color: C.onSurfaceInverse, fontWeight: "700" },
  statusBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm,
    backgroundColor: C.surfaceInverse,
  },
  statusText: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceInverse, letterSpacing: 1 },
  modesWrap: { paddingHorizontal: SP.lg, marginTop: SP.lg },
  sectionLabel: {
    fontFamily: FONT.mono,
    fontSize: FS.sm,
    color: C.onSurfaceTertiary,
    letterSpacing: 1.5,
    marginBottom: SP.sm,
  },
  modeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: SP.lg,
    borderWidth: 2,
    borderColor: C.borderStrong,
    marginBottom: SP.md,
    backgroundColor: C.surface,
  },
  modeCode: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.brand, letterSpacing: 2 },
  modeLabel: {
    fontFamily: FONT.display,
    fontSize: FS["2xl"],
    fontWeight: "900",
    color: C.onSurface,
    letterSpacing: -0.5,
    marginTop: 2,
  },
  modeSub: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, marginTop: 4, letterSpacing: 0.5 },
  modeIconBox: {
    width: 64,
    height: 64,
    borderWidth: 2,
    borderColor: C.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surfaceSecondary,
  },
  archiveBtn: {
    marginTop: SP.md,
    marginHorizontal: SP.lg,
    backgroundColor: C.surfaceInverse,
    padding: SP.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  archiveText: {
    fontFamily: FONT.mono,
    fontSize: FS.lg,
    color: C.onSurfaceInverse,
    letterSpacing: 2,
    fontWeight: "700",
  },
  footer: { paddingHorizontal: SP.lg, marginTop: SP.xl, alignItems: "center", gap: 4 },
  footerText: { fontFamily: FONT.mono, fontSize: 10, color: C.onSurfaceTertiary, letterSpacing: 1 },
});
