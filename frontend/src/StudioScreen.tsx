/**
 * StudioScreen — reusable screen wrapper for each mode.
 * Hosts the renderer, the prompt composer trigger, and SAVE/CLEAR actions.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { C, FONT, FS, SP, type ModeId, type ModelId } from './theme';
import { PromptComposer } from './PromptComposer';
import { useAuth } from './auth';
type Props = {
  mode: ModeId;
  modeCode: string;
  modeLabel: string;
  modeSub: string;
  renderOutput: (text: string) => React.ReactNode;
  placeholder?: string;
  defaultPrompt?: string;
};

export function StudioScreen({
  mode,
  modeCode,
  modeLabel,
  modeSub,
  renderOutput,
  placeholder,
  defaultPrompt,
}: Props) {
  const insets = useSafeAreaInsets();
  const { authFetch, refreshUser, user } = useAuth();
  const [composerOpen, setComposerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noCredits, setNoCredits] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string>('');
  const [lastModel, setLastModel] = useState<ModelId>('claude');
  const [lastDisplay, setLastDisplay] = useState('Claude 4.5');
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const handleGenerate = async (prompt: string, model: ModelId) => {
    setError(null);
    setNoCredits(false);
    setLoading(true);
    setSavedId(null);
    try {
      const r = await authFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, prompt, model }),
      });
      if (r.status === 402) {
        setNoCredits(true);
        setComposerOpen(false);
        return;
      }
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`HTTP ${r.status}: ${text.slice(0, 120)}`);
      }
      const data = await r.json();
      setOutput(data.output);
      setLastPrompt(data.prompt);
      setLastModel(data.model);
      setLastDisplay(data.model_display);
      setComposerOpen(false);
      refreshUser();
    } catch (e: any) {
      setError(e?.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!output) return;
    setSaving(true);
    try {
      const r = await authFetch('/api/creations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          prompt: lastPrompt,
          model: lastModel,
          model_display: lastDisplay,
          output,
        }),
      });
      const data = await r.json();
      setSavedId(data.creation_id || 'saved');
    } catch (e) {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={s.backBtn}
          testID="back-button"
        >
          <Feather name="arrow-left" size={20} color={C.onSurface} />
        </Pressable>
        <View style={{ flex: 1, paddingHorizontal: SP.md }}>
          <Text style={s.code}>MODE {modeCode}</Text>
          <Text style={s.headline}>{modeLabel}</Text>
        </View>
      </View>
      <View style={s.subBar}>
        <Text style={s.sub}>{modeSub.toUpperCase()}</Text>
        <Pressable
          onPress={() => router.push('/wallet')}
          style={s.creditsChip}
          testID="studio-credits-chip"
          hitSlop={8}
        >
          <Feather name="zap" size={11} color={C.brand} />
          <Text style={s.creditsChipText}>{user?.credits ?? 0} CR</Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.lg, paddingBottom: 120 + insets.bottom }}
      >
        {/* Output area */}
        <View style={s.outputArea}>
          {loading && (
            <View style={s.center}>
              <ActivityIndicator size="large" color={C.brand} />
              <Text style={[s.mono, { marginTop: SP.md }]}>GENERATING ...</Text>
              <Text style={[s.mono, { color: C.onSurfaceTertiary, marginTop: SP.xs }]}>
                ENGINE: {lastDisplay.toUpperCase()}
              </Text>
            </View>
          )}
          {!loading && !output && !error && !noCredits && (
            <View style={s.center}>
              <Text style={s.placeholderTitle}>AWAITING INPUT</Text>
              <Text style={[s.mono, { color: C.onSurfaceTertiary, marginTop: SP.sm }]}>
                TAP COMPOSE TO GENERATE
              </Text>
            </View>
          )}
          {!loading && noCredits && (
            <View style={s.noCreditsBlock} testID="no-credits-block">
              <Text style={s.noCreditsTitle}>OUT OF CREDITS</Text>
              <Text style={s.noCreditsBody}>
                EACH GENERATION COSTS 1 CREDIT. TOP UP YOUR WALLET TO KEEP CREATING.
              </Text>
              <Pressable
                onPress={() => router.push('/wallet/buy')}
                style={s.noCreditsBtn}
                testID="goto-buy-credits-button"
              >
                <Text style={s.noCreditsBtnText}>+ BUY CREDITS</Text>
              </Pressable>
            </View>
          )}
          {!loading && error && (
            <View style={s.errorBlock}>
              <Text style={s.errorTitle}>{"// ERROR"}</Text>
              <Text style={s.errorBody}>{error}</Text>
            </View>
          )}
          {!loading && output && renderOutput(output)}
        </View>

        {output && !loading && (
          <View style={s.metaCard}>
            <Text style={s.metaLabel}>{"// PROMPT"}</Text>
            <Text style={s.metaValue}>{lastPrompt}</Text>
            <Text style={[s.metaLabel, { marginTop: SP.md }]}>{"// ENGINE"}</Text>
            <Text style={s.metaValue}>{lastDisplay}</Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[s.actionBar, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        {output && !loading ? (
          <View style={{ flexDirection: 'row', gap: SP.sm }}>
            <Pressable
              onPress={handleSave}
              style={[s.actionBtnLight, savedId && { backgroundColor: C.success }]}
              testID="save-button"
              disabled={saving || !!savedId}
            >
              {saving ? (
                <ActivityIndicator color={C.onSurface} />
              ) : (
                <Text style={[s.actionBtnLightText, savedId && { color: '#FFFFFF' }]}>
                  {savedId ? 'SAVED ✓' : 'SAVE → GALLERY'}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setComposerOpen(true)}
              style={s.actionBtnDark}
              testID="regen-button"
            >
              <Text style={s.actionBtnDarkText}>REGEN</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setComposerOpen(true)}
            style={s.composeBtn}
            testID="open-composer-button"
          >
            <Text style={s.composeBtnText}>+ COMPOSE PROMPT</Text>
          </Pressable>
        )}
      </View>

      <PromptComposer
        visible={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSubmit={handleGenerate}
        loading={loading}
        placeholder={placeholder}
        title={`${modeLabel} // COMPOSER`}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  code: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 1 },
  headline: { fontFamily: FONT.display, fontSize: FS['2xl'], fontWeight: '900', color: C.onSurface, letterSpacing: -0.5 },
  subBar: {
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: C.surfaceInverse,
  },
  sub: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceInverse, letterSpacing: 1 },
  creditsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.brand,
  },
  creditsChipText: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurface, letterSpacing: 1, fontWeight: '700' },
  noCreditsBlock: {
    borderWidth: 2,
    borderColor: C.borderStrong,
    padding: SP.lg,
    width: '100%',
    backgroundColor: C.surfaceInverse,
    alignItems: 'center',
  },
  noCreditsTitle: {
    fontFamily: FONT.display, fontSize: FS['3xl'], fontWeight: '900',
    color: C.onSurfaceInverse, letterSpacing: -1,
  },
  noCreditsBody: {
    fontFamily: FONT.mono, fontSize: FS.sm, color: '#cccccc',
    letterSpacing: 0.5, lineHeight: 20, marginTop: SP.md, textAlign: 'center',
  },
  noCreditsBtn: {
    marginTop: SP.lg, backgroundColor: C.brand, paddingHorizontal: SP.xl, paddingVertical: SP.lg,
  },
  noCreditsBtnText: {
    fontFamily: FONT.mono, fontSize: FS.lg, color: C.onSurfaceInverse, letterSpacing: 2, fontWeight: '700',
  },
  outputArea: { alignItems: 'center', minHeight: 340, justifyContent: 'center' },
  center: { alignItems: 'center', padding: SP.xl },
  placeholderTitle: {
    fontFamily: FONT.display,
    fontSize: FS['3xl'],
    fontWeight: '900',
    color: C.onSurface,
    letterSpacing: -1,
  },
  mono: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurface, letterSpacing: 1 },
  errorBlock: {
    borderWidth: 2,
    borderColor: C.brand,
    padding: SP.md,
    width: '100%',
    backgroundColor: '#FFF5F2',
  },
  errorTitle: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.brand, letterSpacing: 1 },
  errorBody: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurface, marginTop: SP.xs },
  metaCard: {
    marginTop: SP.xl,
    borderWidth: 2,
    borderColor: C.borderStrong,
    padding: SP.md,
    backgroundColor: C.surfaceSecondary,
  },
  metaLabel: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, letterSpacing: 1 },
  metaValue: { fontFamily: FONT.mono, fontSize: FS.base, color: C.onSurface, marginTop: 2 },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.surface,
    borderTopWidth: 2,
    borderColor: C.borderStrong,
    paddingHorizontal: SP.lg,
    paddingTop: SP.md,
  },
  composeBtn: {
    backgroundColor: C.brand,
    paddingVertical: SP.lg,
    alignItems: 'center',
  },
  composeBtnText: {
    fontFamily: FONT.mono,
    fontSize: FS.lg,
    color: C.onSurfaceInverse,
    letterSpacing: 2,
    fontWeight: '700',
  },
  actionBtnDark: {
    flex: 1,
    backgroundColor: C.surfaceInverse,
    paddingVertical: SP.lg,
    alignItems: 'center',
  },
  actionBtnDarkText: {
    fontFamily: FONT.mono,
    fontSize: FS.base,
    color: C.onSurfaceInverse,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  actionBtnLight: {
    flex: 2,
    backgroundColor: C.brand,
    paddingVertical: SP.lg,
    alignItems: 'center',
  },
  actionBtnLightText: {
    fontFamily: FONT.mono,
    fontSize: FS.base,
    color: C.onSurfaceInverse,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
});
