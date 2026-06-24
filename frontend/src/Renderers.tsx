/**
 * Mode renderers — visualize the LLM-generated specs for each creative mode.
 * Brutalist styling. Uses react-native-svg for vector rendering and Reanimated
 * for kinetic effects.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Animated, Easing, Pressable } from 'react-native';
import Svg, {
  Circle,
  Rect,
  Polygon,
  Line,
  G,
  SvgXml,
  Path,
  Text as SvgText,
} from 'react-native-svg';
import { C, FONT, FS, SP } from './theme';

// ---------- safe JSON parser ----------
export function parseSpec<T = any>(text: string): T | null {
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract first { ... }
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

const CANVAS = 320;

// ============= 3D SCENE =============
type SceneObj = {
  type: 'sphere' | 'cube' | 'ring' | 'triangle' | 'line';
  x: number;
  y: number;
  size: number;
  color: string;
  rotation: number;
};
type SceneSpec = {
  title?: string;
  background?: string;
  objects: SceneObj[];
  ambience?: string;
};

export function SceneRenderer({ spec }: { spec: SceneSpec }) {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(rot, {
        toValue: 1,
        duration: 18000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [rot]);
  const rotate = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const objs = Array.isArray(spec?.objects) ? spec.objects : [];
  const bg = spec?.background || '#111111';
  return (
    <View testID="scene-renderer" style={[rStyles.canvasWrap, { backgroundColor: bg }]}>
      <Animated.View style={{ transform: [{ rotate }], width: CANVAS, height: CANVAS }}>
        <Svg width={CANVAS} height={CANVAS} viewBox="0 0 100 100">
          {objs.map((o, i) => {
            const cx = clamp(o.x, 0, 100);
            const cy = clamp(o.y, 0, 100);
            const sz = clamp(o.size, 1, 40);
            const fill = o.color || '#FFFFFF';
            const tr = `rotate(${o.rotation || 0} ${cx} ${cy})`;
            switch (o.type) {
              case 'sphere':
                return <Circle key={i} cx={cx} cy={cy} r={sz / 2} fill={fill} opacity={0.85} />;
              case 'cube':
                return (
                  <Rect
                    key={i}
                    x={cx - sz / 2}
                    y={cy - sz / 2}
                    width={sz}
                    height={sz}
                    fill={fill}
                    opacity={0.85}
                    transform={tr}
                  />
                );
              case 'ring':
                return (
                  <Circle
                    key={i}
                    cx={cx}
                    cy={cy}
                    r={sz / 2}
                    fill="none"
                    stroke={fill}
                    strokeWidth={1.2}
                  />
                );
              case 'triangle': {
                const h = sz;
                const pts = `${cx},${cy - h / 2} ${cx - h / 2},${cy + h / 2} ${cx + h / 2},${cy + h / 2}`;
                return <Polygon key={i} points={pts} fill={fill} opacity={0.85} transform={tr} />;
              }
              case 'line':
                return (
                  <Line
                    key={i}
                    x1={cx - sz / 2}
                    y1={cy}
                    x2={cx + sz / 2}
                    y2={cy}
                    stroke={fill}
                    strokeWidth={1.5}
                    transform={tr}
                  />
                );
              default:
                return null;
            }
          })}
        </Svg>
      </Animated.View>
    </View>
  );
}

// ============= 3D VIDEO TIMELINE =============
type Clip = { start: number; end: number; label: string; color: string };
type Track = { name: string; clips: Clip[] };
type VideoSpec = { title?: string; duration_s: number; tracks: Track[] };

export function VideoRenderer({ spec }: { spec: VideoSpec }) {
  const dur = Math.max(1, spec?.duration_s || 10);
  const tracks = Array.isArray(spec?.tracks) ? spec.tracks : [];
  const ph = useRef(new Animated.Value(0)).current;
  const [time, setTime] = useState(0);

  useEffect(() => {
    ph.setValue(0);
    const id = ph.addListener(({ value }) => setTime(value));
    const anim = Animated.loop(
      Animated.timing(ph, {
        toValue: dur,
        duration: dur * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    );
    anim.start();
    return () => {
      ph.removeListener(id);
      anim.stop();
    };
  }, [dur, ph]);

  const ROW_W = CANVAS;
  const ROW_H = 36;
  const playheadX = ph.interpolate({
    inputRange: [0, dur],
    outputRange: [0, ROW_W],
  });

  return (
    <View testID="video-renderer" style={rStyles.timelineWrap}>
      {/* Preview / Status */}
      <View style={rStyles.previewPanel}>
        <Text style={rStyles.mono}>{(spec?.title || 'UNTITLED').toUpperCase()}</Text>
        <Text style={[rStyles.mono, { color: C.brand, marginTop: SP.xs }]}>
          T: {time.toFixed(1)}s / {dur}s
        </Text>
        <Text style={[rStyles.mono, { marginTop: SP.xs }]}>
          {tracks.length} TRACK(S) · {tracks.reduce((a, t) => a + (t.clips?.length || 0), 0)} CLIP(S)
        </Text>
      </View>
      {/* Ruler */}
      <View style={rStyles.ruler}>
        {Array.from({ length: Math.min(11, dur + 1) }).map((_, i) => (
          <Text key={i} style={rStyles.rulerTick}>
            {Math.round((i / 10) * dur)}s
          </Text>
        ))}
      </View>
      {/* Tracks */}
      <View style={{ position: 'relative' }}>
        {tracks.map((t, ti) => (
          <View key={ti} style={[rStyles.trackRow, { height: ROW_H }]}>
            {(t.clips || []).map((c, ci) => {
              const left = (clamp(c.start, 0, dur) / dur) * ROW_W;
              const w = Math.max(8, ((clamp(c.end, c.start, dur) - c.start) / dur) * ROW_W);
              return (
                <View
                  key={ci}
                  style={[
                    rStyles.clip,
                    { left, width: w, backgroundColor: c.color || C.surfaceTertiary },
                  ]}
                >
                  <Text style={rStyles.clipText} numberOfLines={1}>
                    {c.label}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
        {/* Playhead */}
        <Animated.View
          style={[rStyles.playhead, { left: playheadX, height: tracks.length * ROW_H }]}
        />
      </View>
    </View>
  );
}

// ============= TEXT VIDEO (kinetic typography) =============
type TextFrame = {
  text: string;
  size: number;
  x: number;
  y: number;
  rotation: number;
  weight: 'regular' | 'bold';
  duration_ms: number;
};
type TextVideoSpec = {
  title?: string;
  background?: string;
  color?: string;
  frames: TextFrame[];
};

export function TextVideoRenderer({ spec }: { spec: TextVideoSpec }) {
  const frames = Array.isArray(spec?.frames) ? spec.frames : [];
  const [idx, setIdx] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!frames.length) return;
    let mounted = true;
    let timer: any;
    const playFrame = (i: number) => {
      if (!mounted) return;
      setIdx(i);
      fade.setValue(0);
      Animated.timing(fade, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
      const f = frames[i];
      timer = setTimeout(() => playFrame((i + 1) % frames.length), Math.max(500, f?.duration_ms || 1200));
    };
    playFrame(0);
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [frames, fade]);

  const f = frames[idx];
  const bg = spec?.background || '#111111';
  const color = spec?.color || '#FFFFFF';

  return (
    <View testID="text-video-renderer" style={[rStyles.canvasWrap, { backgroundColor: bg }]}>
      {f && (
        <Animated.Text
          style={{
            position: 'absolute',
            left: `${clamp(f.x, 5, 95)}%`,
            top: `${clamp(f.y, 5, 90)}%`,
            color,
            fontSize: clamp(f.size, 16, 80),
            fontFamily: FONT.display,
            fontWeight: f.weight === 'bold' ? '900' : '400',
            transform: [
              { translateX: -60 },
              { translateY: -20 },
              { rotate: `${clamp(f.rotation || 0, -45, 45)}deg` },
            ],
            opacity: fade,
            letterSpacing: 2,
          }}
        >
          {(f.text || '').toUpperCase()}
        </Animated.Text>
      )}
      <View style={rStyles.frameBadge}>
        <Text style={rStyles.mono}>
          {String(idx + 1).padStart(2, '0')} / {String(frames.length).padStart(2, '0')}
        </Text>
      </View>
    </View>
  );
}

// ============= AUDIO VISUALIZER =============
type AudioNote = { freq: number; start_ms: number; duration_ms: number; amplitude: number };
type AudioSpec = {
  title?: string;
  bpm?: number;
  background?: string;
  accent?: string;
  notes: AudioNote[];
  waveform?: string;
};

export function AudioRenderer({ spec }: { spec: AudioSpec }) {
  const notes = Array.isArray(spec?.notes) ? spec.notes : [];
  const bg = spec?.background || '#111111';
  const accent = spec?.accent || '#FF2A00';
  const phase = useRef(new Animated.Value(0)).current;
  const [p, setP] = useState(0);

  useEffect(() => {
    phase.setValue(0);
    const lis = phase.addListener(({ value }) => setP(value));
    const anim = Animated.loop(
      Animated.timing(phase, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: false })
    );
    anim.start();
    return () => {
      phase.removeListener(lis);
      anim.stop();
    };
  }, [phase]);

  const bars = useMemo(() => {
    const N = 32;
    const arr: number[] = [];
    for (let i = 0; i < N; i++) {
      // synthesize amplitude across notes weighted by frequency band
      let amp = 0;
      notes.forEach((n) => {
        const band = Math.floor(((n.freq - 60) / (2000 - 60)) * N);
        if (band === i) amp += n.amplitude || 0.4;
      });
      arr.push(Math.min(1, amp || 0.1 + (i % 5) * 0.05));
    }
    return arr;
  }, [notes]);

  return (
    <View testID="audio-renderer" style={[rStyles.canvasWrap, { backgroundColor: bg }]}>
      <Svg width={CANVAS} height={CANVAS} viewBox="0 0 320 320">
        {bars.map((amp, i) => {
          const pulse = 0.7 + 0.3 * Math.sin((p * Math.PI * 2) + i * 0.4);
          const h = clamp(amp * 220 * pulse, 4, 240);
          const w = 6;
          const gap = 3;
          const x = 10 + i * (w + gap);
          return (
            <Rect
              key={i}
              x={x}
              y={(320 - h) / 2}
              width={w}
              height={h}
              fill={i % 4 === 0 ? accent : '#FFFFFF'}
            />
          );
        })}
        {/* Center line */}
        <Line x1={0} y1={160} x2={320} y2={160} stroke="#FFFFFF" strokeWidth={0.5} opacity={0.2} />
      </Svg>
      <View style={[rStyles.frameBadge, { top: SP.md, bottom: 'auto' }]}>
        <Text style={rStyles.mono}>{spec?.bpm || 120} BPM · {spec?.waveform || 'sine'}</Text>
      </View>
    </View>
  );
}

// ============= 2D SVG ART =============
export function SvgArtRenderer({ svgText }: { svgText: string }) {
  // Ensure starts with <svg
  const cleaned = (svgText || '').trim();
  const valid = cleaned.startsWith('<svg');
  return (
    <View testID="svg-renderer" style={[rStyles.canvasWrap, { backgroundColor: '#FFFFFF' }]}>
      {valid ? (
        <SvgXml xml={cleaned} width={CANVAS} height={CANVAS} />
      ) : (
        <Text style={[rStyles.mono, { color: C.brand }]}>INVALID SVG OUTPUT</Text>
      )}
    </View>
  );
}

// ============= Helpers =============
function clamp(v: number, lo: number, hi: number) {
  if (typeof v !== 'number' || isNaN(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

const rStyles = StyleSheet.create({
  canvasWrap: {
    width: CANVAS,
    height: CANVAS,
    borderWidth: 2,
    borderColor: C.borderStrong,
    alignSelf: 'center',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineWrap: {
    width: CANVAS,
    alignSelf: 'center',
    borderWidth: 2,
    borderColor: C.borderStrong,
    backgroundColor: C.surface,
    paddingBottom: SP.sm,
  },
  previewPanel: {
    padding: SP.md,
    borderBottomWidth: 2,
    borderColor: C.borderStrong,
    backgroundColor: C.surfaceInverse,
  },
  mono: { fontFamily: FONT.mono, fontSize: FS.sm, color: C.onSurfaceInverse, letterSpacing: 1 },
  ruler: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderColor: C.borderStrong,
    backgroundColor: C.surfaceSecondary,
  },
  rulerTick: { fontFamily: FONT.mono, fontSize: 9, color: C.onSurfaceTertiary },
  trackRow: {
    borderBottomWidth: 1,
    borderColor: C.border,
    position: 'relative',
    backgroundColor: C.surface,
  },
  clip: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderWidth: 1.5,
    borderColor: C.borderStrong,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  clipText: { fontFamily: FONT.mono, fontSize: 9, color: C.onSurface },
  playhead: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: C.brand,
  },
  frameBadge: {
    position: 'absolute',
    bottom: SP.md,
    left: SP.md,
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
});
