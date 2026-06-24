/**
 * Brutalist Mobile LIGHT theme tokens for LEO AI Studio.
 */
export const C = {
  surface: '#FFFFFF',
  onSurface: '#111111',
  surfaceSecondary: '#F4F4F4',
  surfaceTertiary: '#E5E5E5',
  onSurfaceTertiary: '#555555',
  surfaceInverse: '#111111',
  onSurfaceInverse: '#FFFFFF',
  brand: '#FF2A00',
  brandTertiary: '#FFD4CC',
  border: '#E5E5E5',
  borderStrong: '#111111',
  success: '#00B050',
  warning: '#FFB800',
};

export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

export const FONT = {
  display: 'System',
  mono: 'Courier',
};

export const FS = { sm: 12, base: 14, lg: 16, xl: 20, '2xl': 24, '3xl': 32, '4xl': 44 };

export const MODES = [
  {
    id: 'scene',
    code: '01',
    label: '3D SCENE',
    sub: 'Generative geometry',
    route: '/studio/scene',
  },
  {
    id: 'video',
    code: '02',
    label: '3D VIDEO',
    sub: 'Timeline sequencer',
    route: '/studio/video',
  },
  {
    id: 'text_video',
    code: '03',
    label: 'TEXT VIDEO',
    sub: 'Kinetic typography',
    route: '/studio/text-video',
  },
  {
    id: 'audio',
    code: '04',
    label: '3D AUDIO',
    sub: 'Frequency visualizer',
    route: '/studio/audio',
  },
  {
    id: 'svg',
    code: '05',
    label: '2D ART',
    sub: 'SVG synthesis',
    route: '/studio/svg',
  },
] as const;

export const MODELS = [
  { id: 'claude', label: 'CLAUDE 4.5' },
  { id: 'gpt', label: 'GPT 5.2' },
  { id: 'gemini', label: 'GEMINI 3' },
] as const;

export type ModeId = (typeof MODES)[number]['id'];
export type ModelId = (typeof MODELS)[number]['id'];
