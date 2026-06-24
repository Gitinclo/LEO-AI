/**
 * PromptComposer — a bottom-sheet style overlay that captures prompt + model
 * selection and emits onSubmit(prompt, model). Brutalist styling.
 */
import React, { useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { C, FONT, FS, MODELS, SP, type ModelId } from './theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (prompt: string, model: ModelId) => void | Promise<void>;
  loading?: boolean;
  defaultModel?: ModelId;
  placeholder?: string;
  title?: string;
};

export function PromptComposer({
  visible,
  onClose,
  onSubmit,
  loading,
  defaultModel = 'claude',
  placeholder = 'DESCRIBE THE OUTPUT...',
  title = 'PROMPT COMPOSER',
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<ModelId>(defaultModel);

  const handleSubmit = async () => {
    if (!prompt.trim() || loading) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    await onSubmit(prompt.trim(), model);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.backdrop}
      >
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={s.dismissArea} />
        </TouchableWithoutFeedback>

        <View style={s.sheet} testID="prompt-composer">
          <View style={s.header}>
            <Text style={s.titleText}>{title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={s.closeBtn}
              testID="composer-close-button"
            >
              <Feather name="x" size={20} color={C.onSurface} />
            </Pressable>
          </View>

          <View style={s.section}>
            <Text style={s.label}>{"// ENGINE"}</Text>
            <View style={s.segment}>
              {MODELS.map((m) => {
                const active = m.id === model;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      setModel(m.id);
                      if (Platform.OS !== 'web')
                        Haptics.selectionAsync().catch(() => {});
                    }}
                    style={[s.segmentBtn, active && s.segmentBtnActive]}
                    testID={`model-${m.id}-button`}
                  >
                    <Text style={[s.segmentText, active && s.segmentTextActive]}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={s.section}>
            <Text style={s.label}>{"// PROMPT"}</Text>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder={placeholder}
              placeholderTextColor={C.onSurfaceTertiary}
              multiline
              style={s.input}
              testID="composer-prompt-input"
              autoFocus
            />
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={loading || !prompt.trim()}
            style={[s.cta, (!prompt.trim() || loading) && s.ctaDisabled]}
            testID="composer-generate-button"
          >
            {loading ? (
              <ActivityIndicator color={C.onSurfaceInverse} />
            ) : (
              <Text style={s.ctaText}>GENERATE  /  RUN</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: C.surface,
    borderTopWidth: 2,
    borderColor: C.borderStrong,
    paddingHorizontal: SP.lg,
    paddingTop: SP.lg,
    paddingBottom: SP.xl,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleText: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurface, letterSpacing: 1 },
  closeBtn: {
    width: 32,
    height: 32,
    borderWidth: 2,
    borderColor: C.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { marginTop: SP.lg },
  label: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceTertiary, marginBottom: SP.sm },
  segment: { flexDirection: 'row', borderWidth: 2, borderColor: C.borderStrong },
  segmentBtn: { flex: 1, paddingVertical: SP.md, alignItems: 'center', backgroundColor: C.surface },
  segmentBtnActive: { backgroundColor: C.surfaceInverse },
  segmentText: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurface, letterSpacing: 0.5 },
  segmentTextActive: { color: C.onSurfaceInverse },
  input: {
    borderWidth: 2,
    borderColor: C.borderStrong,
    minHeight: 120,
    padding: SP.md,
    fontFamily: FONT.mono,
    fontSize: FS.base,
    color: C.onSurface,
    textAlignVertical: 'top',
  },
  cta: {
    marginTop: SP.xl,
    backgroundColor: C.brand,
    paddingVertical: SP.lg,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: {
    fontFamily: FONT.mono,
    fontSize: FS.lg,
    color: C.onSurfaceInverse,
    letterSpacing: 2,
    fontWeight: '700',
  },
});
