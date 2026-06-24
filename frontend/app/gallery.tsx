/**
 * Gallery — contact-sheet style grid of all saved creations across modes.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { C, FONT, FS, MODES, SP } from "@/src/theme";
import {
  AudioRenderer,
  SceneRenderer,
  SvgArtRenderer,
  TextVideoRenderer,
  VideoRenderer,
  parseSpec,
} from "@/src/Renderers";

type Creation = {
  creation_id: string;
  mode: string;
  prompt: string;
  model: string;
  model_display: string;
  output: string;
  created_at: string;
};

export default function Gallery() {
  const { authFetch } = useAuth();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Creation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState<Creation | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const r = await authFetch("/api/creations");
        const data = await r.json();
        setItems(data.items || []);
      } catch {}
      setLoading(false);
      setRefreshing(false);
    },
    [authFetch]
  );

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.mode === filter)),
    [items, filter]
  );

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((i) => i.creation_id !== id));
    try {
      await authFetch(`/api/creations/${id}`, { method: "DELETE" });
    } catch {}
    setActive(null);
  };

  const { width } = useWindowDimensions();
  const cellW = (width - SP.lg * 2 - 4) / 2; // 2 col with hard border gaps

  const filterChips = [
    { id: "all", label: "ALL" },
    ...MODES.map((m) => ({ id: m.id, label: m.label })),
  ];

  return (
    <SafeAreaView style={s.root} edges={["top"]} testID="gallery-screen">
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
          <Text style={s.metaTop}>{"// ARCHIVE"}</Text>
          <Text style={s.title}>GALLERY</Text>
        </View>
        <View style={s.countBox}>
          <Text style={s.countNum}>{items.length}</Text>
          <Text style={s.countLabel}>TOTAL</Text>
        </View>
      </View>

      {/* Sticky filter chip row */}
      <View style={s.chipBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: SP.lg, gap: SP.sm, alignItems: "center" }}
        >
          {filterChips.map((c) => {
            const active = c.id === filter;
            return (
              <Pressable
                key={c.id}
                onPress={() => setFilter(c.id)}
                style={[s.chip, active && s.chipActive]}
                testID={`chip-${c.id}`}
              >
                <Text style={[s.chipText, active && s.chipTextActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.brand} />
          <Text style={[s.mono, { marginTop: SP.md }]}>LOADING ARCHIVE...</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>ARCHIVE EMPTY</Text>
          <Text style={[s.mono, { color: C.onSurfaceTertiary, marginTop: SP.sm }]}>
            CREATE SOMETHING AND PRESS SAVE.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.creation_id}
          numColumns={2}
          contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.md, paddingBottom: insets.bottom + SP.xl }}
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
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setActive(item)}
              style={[s.cell, { width: cellW, height: cellW }]}
              testID={`gallery-cell-${item.creation_id}`}
            >
              <ThumbRenderer item={item} size={cellW} />
              <View style={s.cellOverlay}>
                <Text style={s.cellMeta}>{modeLabel(item.mode)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      {/* Detail modal */}
      <Modal
        visible={!!active}
        animationType="slide"
        onRequestClose={() => setActive(null)}
        transparent={false}
      >
        {active && (
          <SafeAreaView style={s.detailRoot} edges={["top", "bottom"]}>
            <View style={s.detailHeader}>
              <Pressable
                onPress={() => setActive(null)}
                hitSlop={12}
                style={s.backBtn}
                testID="detail-close"
              >
                <Feather name="x" size={20} color={C.onSurface} />
              </Pressable>
              <Text style={[s.title, { flex: 1, marginLeft: SP.md, fontSize: FS.xl }]}>
                {modeLabel(active.mode)}
              </Text>
              <Pressable
                onPress={() => remove(active.creation_id)}
                style={s.deleteBtn}
                testID="detail-delete"
              >
                <Feather name="trash-2" size={18} color={C.onSurfaceInverse} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: SP.lg }}>
              <View style={s.detailRender}>
                <FullRenderer item={active} />
              </View>
              <View style={[s.metaCard, { marginTop: SP.lg }]}>
                <Text style={s.metaLabel}>{"// PROMPT"}</Text>
                <Text style={s.metaValue}>{active.prompt}</Text>
                <Text style={[s.metaLabel, { marginTop: SP.md }]}>{"// ENGINE"}</Text>
                <Text style={s.metaValue}>{active.model_display}</Text>
                <Text style={[s.metaLabel, { marginTop: SP.md }]}>{"// CREATED"}</Text>
                <Text style={s.metaValue}>
                  {new Date(active.created_at).toLocaleString()}
                </Text>
              </View>
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>
    </SafeAreaView>
  );
}

function modeLabel(id: string): string {
  const m = MODES.find((x) => x.id === id);
  return m?.label || id.toUpperCase();
}

function ThumbRenderer({ item, size }: { item: Creation; size: number }) {
  // For thumbnails we just render a simpler version.
  return (
    <View style={{ width: size, height: size, overflow: "hidden", backgroundColor: "#111" }}>
      <View style={{ transform: [{ scale: size / 320 }], width: 320, height: 320 }}>
        <FullRenderer item={item} />
      </View>
    </View>
  );
}

function FullRenderer({ item }: { item: Creation }) {
  switch (item.mode) {
    case "scene":
      return <SceneRenderer spec={parseSpec(item.output) || { objects: [] }} />;
    case "video":
      return <VideoRenderer spec={parseSpec(item.output) || { duration_s: 10, tracks: [] }} />;
    case "text_video":
      return (
        <TextVideoRenderer
          spec={parseSpec(item.output) || { frames: [], background: "#111", color: "#fff" }}
        />
      );
    case "audio":
      return <AudioRenderer spec={parseSpec(item.output) || { notes: [] }} />;
    case "svg":
      return <SvgArtRenderer svgText={item.output} />;
    default:
      return null;
  }
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
  deleteBtn: {
    width: 36,
    height: 36,
    backgroundColor: C.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  metaTop: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 1 },
  title: { fontFamily: FONT.display, fontSize: FS["2xl"], fontWeight: "900", color: C.onSurface, letterSpacing: -0.5 },
  countBox: {
    borderWidth: 2,
    borderColor: C.borderStrong,
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
    alignItems: "center",
    minWidth: 56,
  },
  countNum: { fontFamily: FONT.display, fontSize: FS.xl, fontWeight: "900", color: C.onSurface },
  countLabel: { fontFamily: FONT.mono, fontSize: 9, color: C.onSurfaceTertiary, letterSpacing: 1 },
  chipBar: { height: 56, justifyContent: "center", borderBottomWidth: 2, borderColor: C.borderStrong },
  chip: {
    height: 36,
    paddingHorizontal: SP.md,
    borderWidth: 2,
    borderColor: C.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surface,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: C.surfaceInverse },
  chipText: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurface, letterSpacing: 1 },
  chipTextActive: { color: C.onSurfaceInverse },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SP.xl },
  mono: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurface, letterSpacing: 1 },
  emptyTitle: { fontFamily: FONT.display, fontSize: FS["3xl"], fontWeight: "900", color: C.onSurface, letterSpacing: -1 },
  cell: {
    borderWidth: 2,
    borderColor: C.borderStrong,
    marginRight: 4,
    marginBottom: 4,
    backgroundColor: "#000",
    overflow: "hidden",
  },
  cellOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  cellMeta: { fontFamily: FONT.mono, fontSize: 10, color: "#fff", letterSpacing: 1 },
  detailRoot: { flex: 1, backgroundColor: C.surface },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SP.lg,
    paddingVertical: SP.md,
    borderBottomWidth: 2,
    borderColor: C.borderStrong,
  },
  detailRender: { alignItems: "center" },
  metaCard: {
    borderWidth: 2,
    borderColor: C.borderStrong,
    padding: SP.md,
    backgroundColor: C.surfaceSecondary,
  },
  metaLabel: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 1 },
  metaValue: { fontFamily: FONT.mono, fontSize: FS.base, color: C.onSurface, marginTop: 2 },
});
