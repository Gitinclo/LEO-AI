/**
 * Profile — shows Google user info + logout.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { C, FONT, FS, SP } from "@/src/theme";

export default function Profile() {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          style={s.backBtn}
          testID="back-button"
          hitSlop={12}
        >
          <Feather name="arrow-left" size={20} color={C.onSurface} />
        </Pressable>
        <Text style={s.title}>OPERATOR</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.xxxl }}>
        <View style={s.card}>
          <View style={s.avatar}>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={{ width: 80, height: 80 }} />
            ) : (
              <Text style={s.avatarText}>
                {(user?.name || "??")
                  .split(/\s+/)
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </Text>
            )}
          </View>
          <Text style={s.label}>{"// NAME"}</Text>
          <Text style={s.value} testID="profile-name">{user?.name || "—"}</Text>
          <Text style={s.label}>{"// EMAIL"}</Text>
          <Text style={s.value} testID="profile-email">{user?.email || "—"}</Text>
          <Text style={s.label}>{"// ID"}</Text>
          <Text style={s.value}>{user?.user_id || "—"}</Text>
        </View>

        <Pressable
          onPress={handleLogout}
          style={s.logoutBtn}
          testID="logout-button"
        >
          <Feather name="log-out" size={18} color={C.onSurfaceInverse} />
          <Text style={s.logoutText}>SIGN OUT</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
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
    marginRight: SP.md,
  },
  title: { fontFamily: FONT.display, fontSize: FS["2xl"], fontWeight: "900", color: C.onSurface, letterSpacing: -0.5 },
  card: {
    borderWidth: 2,
    borderColor: C.borderStrong,
    padding: SP.lg,
    backgroundColor: C.surfaceSecondary,
  },
  avatar: {
    width: 80,
    height: 80,
    borderWidth: 2,
    borderColor: C.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surfaceInverse,
    overflow: "hidden",
    marginBottom: SP.md,
  },
  avatarText: { fontFamily: FONT.mono, fontSize: FS.xl, color: C.onSurfaceInverse, fontWeight: "700" },
  label: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, marginTop: SP.md, letterSpacing: 1 },
  value: { fontFamily: FONT.mono, fontSize: FS.base, color: C.onSurface, marginTop: 4 },
  logoutBtn: {
    marginTop: SP.xl,
    backgroundColor: C.brand,
    paddingVertical: SP.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: SP.sm,
  },
  logoutText: { fontFamily: FONT.mono, fontSize: FS.lg, color: C.onSurfaceInverse, fontWeight: "700", letterSpacing: 2 },
});
