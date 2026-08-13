import { create } from "zustand";
import { applySnap, freeStart, snapReleaseTolerance, snapTargets } from "@/lib/snap";
import {
  applyContinuity,
  KF_EPS,
  valueAt,
  newKeyframe,
  propByKey,
  resolveClip,
  sortKeys,
  upsertKeyframe,
  type Easing,
  type Keyframe,
  type KeyValue,
  type KeyframeMap,
  type TangentSpeed,
} from "@/lib/keyframes";
import { remapCaptionsAfterCuts, toOriginalTime } from "@/lib/caption-remap";
import {
  applyPreset,
  revealModeFor,
  stripPreset,
  type PresetConfig,
  type PresetId,
} from "@/lib/text-presets";
import type { CaptionAnim } from "@/lib/caption-styles";
import {
  BLOCK_PRESETS,
  chunkCaptionWords,
  chunkSegmentsByText,
  type CaptionBlockSize,
} from "@/lib/caption-chunking";
import type { WordTiming } from "@/lib/captions";
import type { Annotation, AnnotationTool } from "@/lib/annotations";
import {
  buildForWindow,
  naturalWindow,
  presetById,
  type EffectCategory,
  type PresetParams,
} from "@/lib/effect-presets";





/* ------------------------------------------------------------------ *
 * Estado central do editor. Toda interação (cortar, arrastar, trim,
 * deletar, selecionar) passa por aqui — timeline, preview e painéis
 * leem sempre a mesma fonte de verdade.
 * ------------------------------------------------------------------ */

export type TrackType = "video" | "audio" | "text" | "overlay";
export type TransitionKind = "none" | "fade" | "slide" | "zoom" | "wipe";
export type TransitionDir = "left" | "right" | "up" | "down";

export const DEFAULT_TRANSITION_DURATION = 0.5;

export interface ZoomKeyframe {
  time: number; // segundos, relativo ao início do clipe na timeline
  scale: number;
  x: number;
  y: number;
}

/** instância de preset de efeito aplicada a um clipe (modo Simples) */
export interface AppliedPreset {
  /** id da instância (marca os keyframes gerados via `origin`) */
  id: string;
  presetId: string;
  category: EffectCategory;
  params: PresetParams;
  /** tempo local (s) da agulha quando o efeito foi aplicado */
  anchor?: number;
  /** o usuário editou manualmente algum keyframe gerado */
  edited?: boolean;
}

/**
 * Efeito com janela própria na linha do tempo: começa e termina em tempo
 * global e pode atravessar vários clipes. Os keyframes gerados ficam em
 * cada clipe coberto, marcados com `origin` = id do efeito.
 */
export interface TimelineEffect {
  id: string;
  presetId: string;
  category: EffectCategory;
  params: PresetParams;
  /** tempo global (s) */
  start: number;
  end: number;
  /** tipo de clipe alvo (o mesmo do clipe onde foi aplicado) */
  targetType: TrackType;
  label: string;
}




export interface Clip {
  id: string;
  trackId: string;
  type: TrackType;
  sourceUrl: string;
  startTime: number;
  duration: number;
  sourceInStart: number;
  sourceInEnd: number;
  // vídeo / áudio
  volume?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  speed?: number;
  /** clipes com o mesmo grupo se movem/cortam juntos (vídeo + áudio separado) */
  linkGroupId?: string;
  /** áudio do próprio clipe silenciado (usado quando o áudio foi separado) */
  muted?: boolean;

  /** transição de ENTRADA deste clipe (sobrepõe o fim do clipe anterior) */
  transition?: TransitionKind;
  transitionDuration?: number;
  transitionDir?: TransitionDir;
  denoise?: boolean;
  /** fades de áudio em segundos */
  fadeIn?: number;
  fadeOut?: number;
  zoomKeyframes?: ZoomKeyframe[];
  /** zoom animável (unificado com o sistema de keyframes) */
  zoom?: number;
  position?: { x: number; y: number };
  // transformações animáveis
  opacity?: number;
  scale?: number;
  rotation?: number;
  /** keyframes por nome de propriedade (tempo relativo ao clipe) */
  keyframes?: KeyframeMap;

  // texto
  textContent?: string;
  fontSize?: number;
  color?: string;
  background?: boolean;
  /** desfoque em px (animável) */
  blur?: number;
  /** revelação 0–1 (typewriter / wipe) */
  reveal?: number;
  revealMode?: "none" | "typewriter" | "wipe";
  /** presets de animação de entrada/saída */
  animIn?: PresetConfig;
  animOut?: PresetConfig;

  // overlay
  overlayKind?: "blur" | "spotlight" | "annotation" | "media";
  /** item da biblioteca de mídia associado (imagem/vídeo/áudio importado) */
  mediaId?: string;
  /** anotação de pós-produção (caneta, seta, formas, destaque) */
  annotation?: Annotation;
  /** legenda gerada automaticamente (permite estilizar todas de uma vez) */
  isCaption?: boolean;
  rect?: { x: number; y: number; w: number; h: number };
  strength?: number;
  /** presets de efeito aplicados no modo Simples */
  effectPresets?: AppliedPreset[];
}

export interface Track {
  id: string;
  type: TrackType;
  label: string;
  clips: Clip[];
}

export type AspectRatio = "16:9" | "9:16" | "1:1";
export type Tool = "select" | "blade";

export type MediaKind = "video" | "image" | "audio";

/** Arquivo importado durante a edição (vive só na sessão da aba). */
export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  url: string;
  blob: Blob;
  /** segundos (vídeo/áudio) */
  duration: number;
  /** data URL de miniatura (vídeo/imagem) */
  thumbnail?: string;
}

export interface SilenceRange {
  start: number;
  end: number;
}

export interface CaptionStyle {
  anim: CaptionAnim;
  fontFamily: string;
  fontSize: number;
  color: string;
  /** cor de realce / fundo */
  highlight: string;
  bgOpacity: number;
  background: boolean;
  place: "bottom" | "middle" | "top";
  align: "left" | "center" | "right";
  bold: boolean;
  italic: boolean;
  outline: boolean;
  /** anima palavra por palavra (senão, linha inteira de uma vez) */
  wordByWord: boolean;
  /** tamanho dos blocos gerados na transcrição automática */
  blockSize: CaptionBlockSize;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  anim: "wordPop",
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: 40,
  color: "#ffffff",
  highlight: "#e53935",
  bgOpacity: 0.55,
  background: true,
  place: "bottom",
  align: "center",
  bold: true,
  italic: false,
  outline: true,
  wordByWord: true,
  blockSize: "medio",
};


export function captionY(place: CaptionStyle["place"]) {
  return place === "top" ? 0.15 : place === "middle" ? 0.5 : 0.85;
}

export interface EditorState {
  projectName: string;
  sourceUrl: string | null;
  sourceDuration: number;
  videoSize: { width: number; height: number };
  duration: number;
  currentTime: number;
  playing: boolean;
  zoom: number;
  aspect: AspectRatio;
  tool: Tool;
  selectedClipId: string | null;
  /** seleção múltipla (o último item é o "âncora" = selectedClipId) */
  selectedClipIds: string[];

  tracks: Track[];
  past: Track[][];
  future: Track[][];
  /** arquivo original (usado por análise de áudio e exportação) */
  sourceBlob: Blob | null;
  /** trechos silenciosos detectados — só interface, não faz parte do projeto */
  silences: SilenceRange[];
  /** trechos já removidos do vídeo (tempo original) — usados para remapear legendas */
  removedRanges: SilenceRange[];
  captionStyle: CaptionStyle;
  /** exibição das sub-linhas de keyframes na timeline (atalho U / UU) */
  kfExpanded: "none" | "animated" | "all";
  /** keyframes selecionados na timeline (permite mover/deletar em conjunto) */
  selectedKeyframes: { prop: string; kfId: string }[];
  /** keyframes copiados (Ctrl/Cmd+C) — colados no playhead */
  kfClipboard: { prop: string; offset: number; value: KeyValue; easing: Easing }[];
  /** preset de zoom aguardando o clique no ponto do preview (modo Simples) */
  pendingEffectPreset:
    | { presetId: string; params: PresetParams; mode?: "apply" }
    | { mode: "repoint"; effectId: string }
    | null;
  /** efeitos com janela própria na linha do tempo */
  effects: TimelineEffect[];
  selectedEffectId: string | null;

  /** ferramenta de anotação ativa no preview (null = seleção normal) */
  annotationTool: AnnotationTool | null;
  annotationColor: string;
  /** espessura em px relativos a um quadro de 720px de altura */
  annotationSize: number;
  annotationFill: boolean;
  /** duração padrão (s) de cada anotação criada */
  annotationDuration: number;
  /** imantação (snap) entre clipes — ligada por padrão */
  snapEnabled: boolean;
  /** edição em ondulação: mover/apagar um corte arrasta os clipes seguintes */
  rippleEnabled: boolean;
  /** linha-guia temporária exibida durante o arraste (segundos) */
  snapGuide: number | null;
  /** arquivos importados durante a edição (apenas em memória, nesta sessão) */
  mediaLibrary: MediaItem[];
}


export interface EditorActions {
  loadSource: (url: string, duration: number, size?: { width: number; height: number }, name?: string) => void;
  reset: () => void;
  setProjectName: (name: string) => void;
  setCurrentTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setZoom: (z: number) => void;
  setAspect: (a: AspectRatio) => void;
  setTool: (t: Tool) => void;
  select: (id: string | null) => void;
  /** Alterna um clipe na seleção (Ctrl/Cmd + clique). */
  toggleSelect: (id: string) => void;
  /** Substitui (ou soma) a seleção — usado pelo laço de seleção. */
  selectMany: (ids: string[], additive?: boolean) => void;
  /** Move todos os clipes selecionados (e seus vinculados) de uma vez. */
  moveSelection: (anchorId: string, newStart: number) => void;
  /** Remove todos os clipes selecionados. */
  removeSelected: () => void;
  /** Duplica todos os clipes selecionados. */
  duplicateSelected: () => void;
  /** Separa o áudio do clipe de vídeo em uma faixa própria (vinculado). */
  detachAudio: (clipId: string) => void;
  /** Liga/desliga o vínculo entre vídeo e áudio separado. */
  toggleLink: (clipId: string) => void;

  /** Reordena as faixas da timeline (arraste vertical). */
  reorderTracks: (from: number, to: number) => void;

  updateClip: (id: string, patch: Partial<Clip>) => void;
  /** Atualiza sem criar ponto de histórico (uso durante arraste contínuo). */
  updateClipLive: (id: string, patch: Partial<Clip>) => void;
  splitAt: (clipId: string, time: number) => void;
  splitPlayhead: () => void;
  removeClip: (id: string) => void;
  duplicateClip: (id: string) => void;
  moveClip: (id: string, newStart: number) => void;
  trimClip: (id: string, side: "start" | "end", newTime: number) => void;
  addTextClip: (text?: string) => void;
  addOverlayClip: (kind: "blur" | "spotlight") => void;
  /* --- imantação --- */
  toggleSnap: () => void;
  /** liga/desliga a edição em ondulação (ripple) */
  toggleRipple: () => void;
  /** encosta todos os clipes de cada faixa, fechando as lacunas dos cortes */
  alignAllClips: () => void;
  /** true quando existe alguma lacuna a ser fechada */
  hasGaps: () => boolean;
  setSnapGuide: (t: number | null) => void;
  /* --- biblioteca de mídia --- */
  addMediaItem: (item: MediaItem) => void;
  removeMediaItem: (id: string) => void;
  /** cria um clipe a partir de um item da biblioteca, no tempo indicado */
  addMediaClip: (mediaId: string, startTime: number) => void;
  /** cria um clipe de anotação na faixa de efeitos, começando no playhead */
  addAnnotationClip: (annotation: Annotation) => void;
  setAnnotationTool: (tool: AnnotationTool | null) => void;
  setAnnotationStyle: (
    patch: Partial<{ color: string; size: number; fill: boolean; duration: number }>,
  ) => void;
  addZoomKeyframe: (clipId: string, timelineTime: number) => void;
  removeZoomKeyframe: (clipId: string, index: number) => void;
  /** Remove trechos e devolve quantas legendas foram remapeadas. */
  cutRanges: (ranges: { start: number; end: number }[]) => number;
  setSourceBlob: (blob: Blob | null) => void;
  setSilences: (ranges: SilenceRange[]) => void;
  addCaptionClips: (
    segments: { start: number; end: number; text: string }[],
    words?: WordTiming[],
  ) => void;
  setCaptionStyle: (patch: Partial<CaptionStyle>) => void;
  clearCaptions: () => void;
  /** transição de entrada de um clipe (módulo de Transições) */
  setTransition: (
    clipId: string,
    patch: { kind?: TransitionKind; duration?: number; dir?: TransitionDir },
  ) => void;
  /* --- keyframes --- */
  /** cria/atualiza um keyframe no playhead com o valor atual da propriedade */
  addKeyframeAt: (clipId: string, prop: string) => void;
  /** altera o valor de um keyframe existente */
  setKeyframeValue: (clipId: string, prop: string, kfId: string, value: KeyValue, live?: boolean) => void;
  /** liga/desliga a animação de uma propriedade (cronômetro) */
  togglePropertyAnimation: (clipId: string, prop: string) => void;
  /** altera o valor: cria/atualiza keyframe se animada, senão valor estático */
  setPropValue: (clipId: string, prop: string, value: KeyValue, live?: boolean) => void;
  moveKeyframes: (clipId: string, moves: { prop: string; kfId: string; time: number }[], live?: boolean) => void;
  setKeyframeEasing: (clipId: string, prop: string, kfId: string, easing: Easing) => void;
  /** modal "Velocidade do quadro-chave" (tangentes de Bezier) */
  setKeyframeSpeed: (
    clipId: string,
    prop: string,
    kfId: string,
    patch: {
      incomingSpeed?: Partial<TangentSpeed>;
      outgoingSpeed?: Partial<TangentSpeed>;
      continuous?: boolean;
    },
    live?: boolean,
  ) => void;
  /** presets de animação de entrada/saída de texto */
  setTextPreset: (clipId: string, side: "in" | "out", cfg: Partial<PresetConfig>) => void;

  /* --- presets de efeito (modo Simples) --- */
  /** aplica/substitui um preset de efeito, gerando keyframes automaticamente */
  applyEffectPreset: (clipId: string, presetId: string, params?: PresetParams) => void;
  updateEffectPresetParams: (clipId: string, instanceId: string, params: PresetParams) => void;
  removeEffectPreset: (clipId: string, instanceId: string) => void;
  /** move o efeito na linha do tempo (mantém a duração) */
  moveEffect: (effectId: string, start: number) => void;
  /** estica/encurta a janela do efeito */
  resizeEffect: (effectId: string, start: number, end: number) => void;
  selectEffect: (effectId: string | null) => void;
  /** arma o modo "clique no ponto do preview" para presets de zoom */
  setPendingEffectPreset: (
    value:
      | { presetId: string; params: PresetParams; mode?: "apply" }
      | { mode: "repoint"; effectId: string }
      | null,
  ) => void;
  /** redefine o ponto de foco (zoom) de um efeito já aplicado */
  setEffectPoint: (effectId: string, point: { x: number; y: number }) => void;


  removeKeyframe: (clipId: string, prop: string, kfId: string) => void;
  removeSelectedKeyframes: () => void;
  selectKeyframe: (prop: string, kfId: string, additive?: boolean) => void;
  /** seleção por marquee: substitui ou soma à seleção atual */
  selectKeyframes: (list: { prop: string; kfId: string }[], additive?: boolean) => void;
  clearKeyframeSelection: () => void;
  /** define o tempo exato (local ao clipe) de um keyframe */
  setKeyframeTime: (clipId: string, prop: string, kfId: string, time: number) => void;
  /** desloca todos os keyframes selecionados mantendo o espaçamento */
  nudgeSelectedKeyframes: (delta: number) => void;
  copySelectedKeyframes: () => void;
  pasteKeyframes: () => void;
  cycleKeyframeRows: (all?: boolean) => void;
  undo: () => void;
  redo: () => void;
  commit: () => void;
}


export const MIN_CLIP = 0.12;
const uid = () => Math.random().toString(36).slice(2, 10);

const VIDEO_TRACK = "track-video";
const OVERLAY_TRACK = "track-overlay";
const TEXT_TRACK = "track-text";
const AUDIO_TRACK = "track-audio";

function emptyTracks(): Track[] {
  /* Ordem padrão: o áudio (waveform) fica logo abaixo do vídeo. */
  return [
    { id: VIDEO_TRACK, type: "video", label: "Vídeo", clips: [] },
    { id: AUDIO_TRACK, type: "audio", label: "Áudio", clips: [] },
    { id: OVERLAY_TRACK, type: "overlay", label: "Efeitos", clips: [] },
    { id: TEXT_TRACK, type: "text", label: "Texto", clips: [] },
  ];
}


export function allClips(tracks: Track[]): Clip[] {
  return tracks.flatMap((t) => t.clips);
}

/** o clipe de áudio corresponde ao áudio embutido daquele vídeo? */
export function audioMatchesVideo(audio: Clip, video: Clip): boolean {
  if (audio.type !== "audio" || video.type !== "video") return false;
  if (audio.sourceUrl !== video.sourceUrl) return false;
  const overlap =
    Math.min(audio.startTime + audio.duration, video.startTime + video.duration) -
    Math.max(audio.startTime, video.startTime);
  return overlap > 0.05 || Math.abs(audio.sourceInStart - video.sourceInStart) < 0.05;
}

/** o vídeo ainda tem áudio embutido para ser separado? */
export function canDetachAudio(tracks: Track[], clip: Clip): boolean {
  if (clip.type !== "video" || clip.muted) return false;
  return !allClips(tracks).some((c) => c.type === "audio" && audioMatchesVideo(c, clip));
}



/**
 * Regera os keyframes de todos os efeitos com janela própria.
 * Keyframes marcados com `origin` começando por "fx-" pertencem a efeitos
 * e são sempre reconstruídos; keyframes manuais ficam intactos.
 */
export function applyEffectsToTracks(tracks: Track[], effects: TimelineEffect[]): Track[] {
  return tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      const map: KeyframeMap = {};
      for (const [prop, keys] of Object.entries(clip.keyframes ?? {})) {
        const rest = keys.filter((k) => !k.origin?.startsWith("fx-"));
        if (rest.length) map[prop] = rest;
      }
      const clipEnd = clip.startTime + clip.duration;
      for (const fx of effects) {
        if (fx.targetType !== clip.type) continue;
        const from = Math.max(fx.start, clip.startTime);
        const to = Math.min(fx.end, clipEnd);
        if (to - from <= 0.02) continue;
        const def = presetById(fx.presetId);
        if (!def) continue;
        const generated = buildForWindow(clip, def, fx.params, fx.start, fx.end);
        for (const [prop, keys] of Object.entries(generated)) {
          const tagged = keys.map((k) => ({ ...k, origin: fx.id }));
          const existing = (map[prop] ?? []).filter(
            (k) => !tagged.some((t) => Math.abs(t.time - k.time) < 0.005),
          );
          map[prop] = sortKeys([...existing, ...tagged]);
        }
      }
      return { ...clip, keyframes: map };
    }),
  }));
}


export function findClip(tracks: Track[], id: string | null): Clip | null {
  if (!id) return null;
  for (const t of tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return c;
  }
  return null;
}

/**
 * Ids que devem se mover/apagar juntos: a seleção atual (quando o clipe
 * arrastado faz parte dela) somada aos clipes vinculados (vídeo + áudio).
 */
export function selectionGroup(
  tracks: Track[],
  selectedIds: string[],
  anchorId: string,
): string[] {
  const base = selectedIds.includes(anchorId) ? selectedIds : [anchorId];
  const out = new Set<string>();
  for (const id of base) {
    out.add(id);
    const clip = findClip(tracks, id);
    if (!clip?.linkGroupId) continue;
    for (const other of allClips(tracks))
      if (other.linkGroupId === clip.linkGroupId) out.add(other.id);
  }
  return [...out];
}


export function timelineDuration(tracks: Track[]): number {
  return allClips(tracks).reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
}

/** Empurra vizinhos para a direita para impedir sobreposição na mesma faixa. */
function mapTracks(tracks: Track[], fn: (clips: Clip[], track: Track) => Clip[]): Track[] {
  return tracks.map((t) => ({ ...t, clips: fn(t.clips, t) }));
}

const EPS = 1e-6;

/** Posições finais de cada clipe quando a faixa é compactada a partir de 0. */
function packedStarts(tracks: Track[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tracks) {
    let cursor = 0;
    for (const c of [...t.clips].sort((a, b) => a.startTime - b.startTime)) {
      out.set(c.id, cursor);
      cursor += c.duration;
    }
  }
  return out;
}

/** Compacta todas as faixas mantendo vídeo+áudio vinculados no mesmo tempo. */
function alignTracks(tracks: Track[]): Track[] {
  const packed = packedStarts(tracks);
  // clipes vinculados recebem o menor tempo do grupo, preservando o sincronismo
  const groupStart = new Map<string, number>();
  for (const c of allClips(tracks)) {
    if (!c.linkGroupId) continue;
    const v = packed.get(c.id) ?? c.startTime;
    const cur = groupStart.get(c.linkGroupId);
    groupStart.set(c.linkGroupId, cur == null ? v : Math.min(cur, v));
  }
  return mapTracks(tracks, (clips) =>
    clips
      .map((c) => {
        const start =
          (c.linkGroupId ? groupStart.get(c.linkGroupId) : undefined) ??
          packed.get(c.id) ??
          c.startTime;
        return start === c.startTime ? c : { ...c, startTime: Math.max(0, start) };
      })
      .sort((a, b) => a.startTime - b.startTime),
  );
}

/**
 * Ondulação: desloca `movingIds` por `delta` e leva junto todo clipe que
 * começa depois deles na mesma faixa (mantendo os espaçamentos).
 */
function rippleMove(tracks: Track[], movingIds: Set<string>, delta: number): Track[] {
  if (Math.abs(delta) < EPS) return tracks;
  const followers = new Set<string>();
  for (const t of tracks) {
    const moving = t.clips.filter((c) => movingIds.has(c.id));
    if (moving.length === 0) continue;
    const lastEnd = moving.reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
    for (const c of t.clips)
      if (!movingIds.has(c.id) && c.startTime >= lastEnd - EPS) followers.add(c.id);
  }
  const affected = (c: Clip) => movingIds.has(c.id) || followers.has(c.id);
  // limite: nada pode ir para antes de 0
  let applied = delta;
  for (const c of allClips(tracks))
    if (affected(c)) applied = Math.max(applied, -c.startTime);
  if (Math.abs(applied) < EPS) return tracks;
  return mapTracks(tracks, (clips) =>
    clips
      .map((c) => (affected(c) ? { ...c, startTime: Math.max(0, c.startTime + applied) } : c))
      .sort((a, b) => a.startTime - b.startTime),
  );
}

/** Ondulação ao apagar: os clipes seguintes recuam pelo espaço liberado. */
function rippleRemove(tracks: Track[], ids: Set<string>): Track[] {
  return mapTracks(tracks, (clips) => {
    const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
    let shift = 0;
    const out: Clip[] = [];
    for (const c of sorted) {
      if (ids.has(c.id)) {
        shift += c.duration;
        continue;
      }
      out.push(shift > EPS ? { ...c, startTime: Math.max(0, c.startTime - shift) } : c);
    }
    return out;
  });
}

export const useEditor = create<EditorState & EditorActions>((set, get) => {
  const snapshot = () =>
    set((s) => ({ past: [...s.past.slice(-49), s.tracks], future: [] }));

  const write = (fn: (tracks: Track[]) => Track[]) => {
    snapshot();
    set((s) => {
      const tracks = fn(s.tracks);
      return { tracks, duration: timelineDuration(tracks) };
    });
  };

  return {
    projectName: "Meu projeto",
    sourceUrl: null,
    sourceDuration: 0,
    videoSize: { width: 1280, height: 720 },
    duration: 0,
    currentTime: 0,
    playing: false,
    zoom: 60,
    aspect: "16:9",
    tool: "select",
    selectedClipId: null,
    selectedClipIds: [],


    tracks: emptyTracks(),
    past: [],
    future: [],
    sourceBlob: null,
    silences: [],
    removedRanges: [],
    captionStyle: DEFAULT_CAPTION_STYLE,
    kfExpanded: "none",
    selectedKeyframes: [],
    kfClipboard: [],
    effects: [],
    selectedEffectId: null,

    pendingEffectPreset: null,
    snapEnabled: true,
    rippleEnabled: false,
    snapGuide: null,
    mediaLibrary: [],
    annotationTool: null,
    annotationColor: "#ef4444",
    annotationSize: 6,
    annotationFill: false,
    annotationDuration: 3,


    loadSource: (url, duration, size, name) => {
      const tracks = emptyTracks();
      const linkGroupId = uid();
      const clip: Clip = {
        id: uid(),
        trackId: VIDEO_TRACK,
        type: "video",
        sourceUrl: url,
        startTime: 0,
        duration,
        sourceInStart: 0,
        sourceInEnd: duration,
        volume: 1,
        brightness: 0,
        contrast: 1,
        saturation: 1,
        speed: 1,
        transition: "none",
        denoise: false,
        zoomKeyframes: [],
        position: { x: 0, y: 0 },
        // o áudio nasce em faixa própria: o vídeo fica mudo internamente
        linkGroupId,
        muted: true,
      };
      const audio: Clip = {
        id: uid(),
        trackId: AUDIO_TRACK,
        type: "audio",
        sourceUrl: url,
        startTime: 0,
        duration,
        sourceInStart: 0,
        sourceInEnd: duration,
        speed: 1,
        volume: 1,
        linkGroupId,
      };
      tracks[0].clips = [clip];
      const audioTrack = tracks.find((t) => t.id === AUDIO_TRACK);
      if (audioTrack) audioTrack.clips = [audio];
      set({
        sourceUrl: url,
        sourceDuration: duration,
        videoSize: size ?? { width: 1280, height: 720 },
        projectName: name ?? get().projectName,
        tracks,
        duration,
        currentTime: 0,
        playing: false,
        selectedClipId: clip.id,
        selectedClipIds: [clip.id],
        past: [],
        future: [],
        silences: [],
        removedRanges: [],
      });

    },

    reset: () =>
      set({
        sourceUrl: null,
        sourceDuration: 0,
        tracks: emptyTracks(),
        duration: 0,
        currentTime: 0,
        playing: false,
        selectedClipId: null,
        selectedClipIds: [],
        past: [],
        future: [],
      }),

    setProjectName: (projectName) => set({ projectName }),
    setCurrentTime: (t) => set({ currentTime: Math.max(0, t) }),
    setPlaying: (playing) => set({ playing }),
    setZoom: (z) => set({ zoom: Math.min(400, Math.max(10, z)) }),
    setAspect: (aspect) => set({ aspect }),
    setTool: (tool) => set({ tool }),
    select: (selectedClipId) =>
      set({
        selectedClipId,
        selectedClipIds: selectedClipId ? [selectedClipId] : [],
        selectedKeyframes: [],
        selectedEffectId: null,
      }),

    toggleSelect: (id) =>
      set((s) => {
        const has = s.selectedClipIds.includes(id);
        const ids = has ? s.selectedClipIds.filter((x) => x !== id) : [...s.selectedClipIds, id];
        return {
          selectedClipIds: ids,
          selectedClipId: ids[ids.length - 1] ?? null,
          selectedKeyframes: [],
          selectedEffectId: null,
        };
      }),

    selectMany: (ids, additive) =>
      set((s) => {
        const next = additive ? [...new Set([...s.selectedClipIds, ...ids])] : [...new Set(ids)];
        return {
          selectedClipIds: next,
          selectedClipId: next[next.length - 1] ?? null,
          selectedKeyframes: [],
          selectedEffectId: next.length > 0 ? null : s.selectedEffectId,
        };
      }),

    moveSelection: (anchorId, newStart) => {
      const s = get();
      const ids = selectionGroup(s.tracks, s.selectedClipIds, anchorId);
      if (ids.length <= 1) {
        get().moveClip(anchorId, newStart);
        return;
      }
      const anchor = findClip(s.tracks, anchorId);
      if (!anchor) return;
      const moving = ids
        .map((id) => findClip(s.tracks, id))
        .filter((c): c is Clip => Boolean(c));
      if (moving.length === 0) return;
      // o grupo se move junto; o único limite é não passar do tempo zero.
      const minStart = moving.reduce((m, c) => Math.min(m, c.startTime), Infinity);
      const delta = Math.max(newStart - anchor.startTime, -minStart);
      if (!Number.isFinite(delta) || Math.abs(delta) < 1e-6) return;
      const movingIds = new Set(ids);
      if (s.rippleEnabled) {
        write((tracks) => rippleMove(tracks, movingIds, delta));
        return;
      }
      write((tracks) =>
        mapTracks(tracks, (clips) => {
          if (!clips.some((c) => movingIds.has(c.id))) return clips;
          const moved = clips
            .filter((c) => movingIds.has(c.id))
            .map((c) => ({ ...c, startTime: Math.max(0, c.startTime + delta) }));
          // vizinhos parados são reacomodados na lacuna livre mais próxima,
          // preservando a ordem — o grupo nunca fica travado.
          const placed: Clip[] = [...moved];
          for (const c of clips
            .filter((x) => !movingIds.has(x.id))
            .sort((a, b) => a.startTime - b.startTime)) {
            const start = freeStart(placed, c.startTime, c.duration);
            placed.push({ ...c, startTime: start });
          }
          return placed.sort((a, b) => a.startTime - b.startTime);
        }),
      );
    },


    removeSelected: () => {
      const s = get();
      const ids = new Set<string>();
      for (const id of s.selectedClipIds)
        for (const g of selectionGroup(s.tracks, [id], id)) ids.add(g);
      if (ids.size === 0) return;
      write((tracks) =>
        s.rippleEnabled
          ? rippleRemove(tracks, ids)
          : mapTracks(tracks, (clips) => clips.filter((c) => !ids.has(c.id))),
      );
      set({ selectedClipId: null, selectedClipIds: [] });
    },

    duplicateSelected: () => {
      const ids = [...get().selectedClipIds];
      for (const id of ids) get().duplicateClip(id);
    },

    detachAudio: (clipId) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip || clip.type !== "video") return;
      const linkGroupId = clip.linkGroupId ?? uid();
      // já existe áudio correspondente? então só revincula (nunca duplica)
      const existing = allClips(get().tracks).find(
        (c) => c.type === "audio" && audioMatchesVideo(c, clip),
      );
      if (existing) {
        write((tracks) =>
          mapTracks(tracks, (clips) =>
            clips.map((c) =>
              c.id === clip.id
                ? { ...c, linkGroupId, muted: true }
                : c.id === existing.id
                  ? { ...c, linkGroupId }
                  : c,
            ),
          ),
        );
        set({ selectedClipId: existing.id, selectedClipIds: [existing.id] });
        return;
      }
      const audio: Clip = {
        id: uid(),
        trackId: AUDIO_TRACK,
        type: "audio",
        sourceUrl: clip.sourceUrl,
        startTime: clip.startTime,
        duration: clip.duration,
        sourceInStart: clip.sourceInStart,
        sourceInEnd: clip.sourceInEnd,
        speed: clip.speed ?? 1,
        volume: clip.volume ?? 1,
        linkGroupId,
      };
      write((tracks) =>
        mapTracks(tracks, (clips, track) => {
          if (track.id === clip.trackId)
            return clips.map((c) => (c.id === clipId ? { ...c, linkGroupId, muted: true } : c));
          if (track.id === AUDIO_TRACK)
            return [...clips, audio].sort((a, b) => a.startTime - b.startTime);
          return clips;
        }),
      );
      set({ selectedClipId: audio.id, selectedClipIds: [audio.id] });
    },

    toggleLink: (clipId) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip) return;
      if (clip.linkGroupId) {
        const group = clip.linkGroupId;
        write((tracks) =>
          mapTracks(tracks, (clips) =>
            clips.map((c) => (c.linkGroupId === group ? { ...c, linkGroupId: undefined } : c)),
          ),
        );
        return;
      }
      // religa apenas com o par compatível: mesma origem e sobreposição no tempo
      const partner = allClips(get().tracks).find((c) =>
        clip.type === "audio"
          ? c.type === "video" && !c.linkGroupId && audioMatchesVideo(clip, c)
          : c.type === "audio" && !c.linkGroupId && audioMatchesVideo(c, clip),
      );
      if (!partner) return;
      const group = uid();
      write((tracks) =>
        mapTracks(tracks, (clips) =>
          clips.map((c) =>
            c.id === clip.id || c.id === partner.id ? { ...c, linkGroupId: group } : c,
          ),
        ),
      );
    },



    reorderTracks: (from, to) =>
      set((s) => {
        if (from === to || from < 0 || to < 0 || from >= s.tracks.length || to >= s.tracks.length)
          return {};
        const tracks = [...s.tracks];
        const [moved] = tracks.splice(from, 1);
        if (!moved) return {};
        tracks.splice(to, 0, moved);
        return { tracks };
      }),


    updateClip: (id, patch) =>
      write((tracks) =>
        mapTracks(tracks, (clips) => clips.map((c) => (c.id === id ? { ...c, ...patch } : c))),
      ),

    updateClipLive: (id, patch) =>
      set((s) => ({
        tracks: mapTracks(s.tracks, (clips) =>
          clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        ),
      })),



    splitAt: (clipId, time) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip) return;
      const local = time - clip.startTime;
      if (local < MIN_CLIP || clip.duration - local < MIN_CLIP) return;
      // clipes vinculados (vídeo + áudio separado) são cortados no mesmo ponto
      const targets = clip.linkGroupId
        ? allClips(get().tracks).filter(
            (c) =>
              c.linkGroupId === clip.linkGroupId &&
              time > c.startTime + MIN_CLIP &&
              time < c.startTime + c.duration - MIN_CLIP,
          )
        : [clip];
      // as partes da direita ganham um vínculo próprio: cada pedaço de vídeo
      // fica ligado só ao seu pedaço de áudio (e não a todos os cortes).
      const rightGroup = clip.linkGroupId ? uid() : undefined;
      const splitOne = (c: Clip): Clip[] => {
        const l = time - c.startTime;
        const speed = c.speed ?? 1;
        const cut = c.sourceInStart + l * speed;
        return [
          { ...c, duration: l, sourceInEnd: cut },
          {
            ...c,
            id: uid(),
            startTime: c.startTime + l,
            duration: c.duration - l,
            sourceInStart: cut,
            transition: "none",
            ...(c.linkGroupId ? { linkGroupId: rightGroup } : {}),
          },
        ];
      };
      const ids = new Set(targets.map((c) => c.id));
      let selected: string | null = null;
      write((tracks) =>
        mapTracks(tracks, (clips) =>
          clips.flatMap((c) => {
            if (!ids.has(c.id)) return [c];
            const parts = splitOne(c);
            if (c.id === clipId) selected = parts[1].id;
            return parts;
          }),
        ),
      );
      if (selected) set({ selectedClipId: selected, selectedClipIds: [selected] });
    },

    splitPlayhead: () => {
      const { tracks, currentTime, selectedClipId } = get();
      const target =
        findClip(tracks, selectedClipId) ??
        allClips(tracks).find(
          (c) => c.type === "video" && currentTime > c.startTime && currentTime < c.startTime + c.duration,
        );
      if (target) get().splitAt(target.id, currentTime);
    },

    removeClip: (id) => {
      const ids = new Set(selectionGroup(get().tracks, [id], id));
      const ripple = get().rippleEnabled;
      write((tracks) =>
        ripple
          ? rippleRemove(tracks, ids)
          : mapTracks(tracks, (clips) => clips.filter((c) => !ids.has(c.id))),
      );
      if (ids.has(get().selectedClipId ?? "")) set({ selectedClipId: null, selectedClipIds: [] });
    },


    duplicateClip: (id) => {
      const clip = findClip(get().tracks, id);
      if (!clip) return;
      const copy: Clip = { ...clip, id: uid(), startTime: clip.startTime + clip.duration };
      write((tracks) =>
        mapTracks(tracks, (clips, track) => {
          if (track.id !== clip.trackId) return clips;
          copy.startTime = freeStart(clips, copy.startTime, copy.duration);
          return [...clips, copy].sort((a, b) => a.startTime - b.startTime);
        }),
      );
      set({ selectedClipId: copy.id, selectedClipIds: [copy.id] });
    },

    moveClip: (id, newStart) => {
      const clip = findClip(get().tracks, id);
      if (!clip) return;
      const { snapEnabled, zoom, currentTime, duration, tracks: allTracks } = get();
      let desired = Math.max(0, newStart);
      if (snapEnabled) {
        const targets = snapTargets(allTracks, {
          excludeClipId: id,
          playhead: currentTime,
          duration,
        });
        const tol = snapReleaseTolerance(zoom);
        const a = applySnap(desired, targets, tol);
        const b = applySnap(desired + clip.duration, targets, tol);
        const da = a.guide != null ? Math.abs(a.time - desired) : Infinity;
        const db = b.guide != null ? Math.abs(b.time - (desired + clip.duration)) : Infinity;
        if (da <= db && a.guide != null) desired = a.time;
        else if (b.guide != null) desired = Math.max(0, b.time - clip.duration);
      }
      if (get().rippleEnabled) {
        const group = new Set(selectionGroup(allTracks, [id], id));
        write((tracks) => rippleMove(tracks, group, desired - clip.startTime));
        return;
      }
      write((tracks) =>
        mapTracks(tracks, (clips, track) => {
          if (track.id !== clip.trackId) return clips;
          const others = clips.filter((c) => c.id !== id);
          const start = freeStart(others, desired, clip.duration);
          return clips
            .map((c) => (c.id === id ? { ...c, startTime: start } : c))
            .sort((a, b) => a.startTime - b.startTime);
        }),
      );
    },


    trimClip: (id, side, newTime) => {
      const clip = findClip(get().tracks, id);
      if (!clip) return;
      const speed = clip.speed ?? 1;
      const siblings = (get().tracks.find((t) => t.id === clip.trackId)?.clips ?? []).filter(
        (c) => c.id !== id,
      );
      // limites impostos pelos vizinhos: o trim nunca invade outro clipe
      const leftBound = siblings
        .filter((c) => c.startTime + c.duration <= clip.startTime + 1e-6)
        .reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
      const rightBound = siblings
        .filter((c) => c.startTime >= clip.startTime + clip.duration - 1e-6)
        .reduce((m, c) => Math.min(m, c.startTime), Infinity);
      let patch: Partial<Clip> = {};
      if (side === "start") {
        const maxStart = clip.startTime + clip.duration - MIN_CLIP;
        const start = Math.max(leftBound, Math.min(newTime, maxStart));
        const delta = start - clip.startTime;
        const sourceInStart = Math.max(0, clip.sourceInStart + delta * speed);
        patch = {
          startTime: start,
          duration: clip.duration - delta,
          sourceInStart,
        };
      } else {
        const end = Math.min(
          rightBound,
          Math.max(clip.startTime + MIN_CLIP, newTime),
        );
        const duration = end - clip.startTime;
        const sourceInEnd = Math.min(
          get().sourceDuration || Infinity,
          clip.sourceInStart + duration * speed,
        );
        patch = { duration: (sourceInEnd - clip.sourceInStart) / speed, sourceInEnd };
      }
      // o par vinculado (áudio separado) é aparado junto
      const partners = clip.linkGroupId
        ? allClips(get().tracks).filter(
            (c) => c.linkGroupId === clip.linkGroupId && c.id !== id,
          )
        : [];
      write((tracks) =>
        mapTracks(tracks, (clips) =>
          clips.map((c) => {
            if (c.id === id) return { ...c, ...patch };
            if (!partners.some((p) => p.id === c.id)) return c;
            return { ...c, ...patch };
          }),
        ),
      );
    },



    addTextClip: (text) => {
      const { currentTime, duration } = get();
      const clip: Clip = {
        id: uid(),
        trackId: TEXT_TRACK,
        type: "text",
        sourceUrl: "",
        startTime: Math.min(currentTime, Math.max(0, duration - 1)),
        duration: 3,
        sourceInStart: 0,
        sourceInEnd: 3,
        textContent: text ?? "Novo texto",
        fontSize: 48,
        color: "#ffffff",
        background: true,
        position: { x: 0.5, y: 0.82 },
      };
      write((tracks) =>
        mapTracks(tracks, (clips, track) =>
          track.id === TEXT_TRACK ? [...clips, clip] : clips,
        ),
      );
      set({ selectedClipId: clip.id, selectedClipIds: [clip.id] });
    },

    addOverlayClip: (kind) => {
      const { currentTime } = get();
      const clip: Clip = {
        id: uid(),
        trackId: OVERLAY_TRACK,
        type: "overlay",
        sourceUrl: "",
        startTime: currentTime,
        duration: 3,
        sourceInStart: 0,
        sourceInEnd: 3,
        overlayKind: kind,
        rect: kind === "blur" ? { x: 0.1, y: 0.7, w: 0.5, h: 0.2 } : { x: 0.35, y: 0.3, w: 0.3, h: 0.4 },
        strength: kind === "blur" ? 12 : 0.7,
      };
      write((tracks) =>
        mapTracks(tracks, (clips, track) =>
          track.id === OVERLAY_TRACK ? [...clips, clip] : clips,
        ),
      );
      set({ selectedClipId: clip.id, selectedClipIds: [clip.id] });
    },

    toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled, snapGuide: null })),
    toggleRipple: () => set((s) => ({ rippleEnabled: !s.rippleEnabled })),

    hasGaps: () => {
      const packed = packedStarts(get().tracks);
      return allClips(get().tracks).some(
        (c) => Math.abs((packed.get(c.id) ?? c.startTime) - c.startTime) > 1e-3,
      );
    },

    alignAllClips: () => {
      if (!get().hasGaps()) return;
      write((tracks) => alignTracks(tracks));
      set({ snapGuide: null });
    },
    setSnapGuide: (snapGuide) => set({ snapGuide }),

    addMediaItem: (item) => set((s) => ({ mediaLibrary: [...s.mediaLibrary, item] })),

    removeMediaItem: (id) =>
      set((s) => ({ mediaLibrary: s.mediaLibrary.filter((m) => m.id !== id) })),

    addMediaClip: (mediaId, startTime) => {
      const item = get().mediaLibrary.find((m) => m.id === mediaId);
      if (!item) return;
      const dur = item.kind === "image" ? 5 : Math.max(MIN_CLIP, item.duration || 5);
      const isAudio = item.kind === "audio";
      const clip: Clip = {
        id: uid(),
        trackId: isAudio ? AUDIO_TRACK : OVERLAY_TRACK,
        type: isAudio ? "audio" : "overlay",
        sourceUrl: item.url,
        mediaId: item.id,
        startTime: Math.max(0, startTime),
        duration: dur,
        sourceInStart: 0,
        sourceInEnd: dur,
        volume: 1,
        ...(isAudio
          ? {}
          : { overlayKind: "media" as const, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, opacity: 1 }),
      };
      write((tracks) =>
        mapTracks(tracks, (clips, track) => {
          if (track.id !== clip.trackId) return clips;
          clip.startTime = freeStart(clips, clip.startTime, clip.duration);
          return [...clips, clip].sort((a, b) => a.startTime - b.startTime);
        }),
      );
      set({ selectedClipId: clip.id, selectedClipIds: [clip.id], snapGuide: null });
    },

    addAnnotationClip: (annotation) => {
      const { currentTime, annotationDuration, duration } = get();
      const dur = Math.max(MIN_CLIP, annotationDuration);
      const clip: Clip = {
        id: uid(),
        trackId: OVERLAY_TRACK,
        type: "overlay",
        sourceUrl: "",
        startTime: currentTime,
        duration: Math.max(MIN_CLIP, Math.min(dur, Math.max(dur, duration - currentTime))),
        sourceInStart: 0,
        sourceInEnd: dur,
        overlayKind: "annotation",
        annotation,
      };
      write((tracks) =>
        mapTracks(tracks, (clips, track) =>
          track.id === OVERLAY_TRACK ? [...clips, clip] : clips,
        ),
      );
      set({ selectedClipId: clip.id, selectedClipIds: [clip.id] });
    },

    setAnnotationTool: (annotationTool) => set({ annotationTool }),

    setAnnotationStyle: (patch) =>
      set((s) => ({
        annotationColor: patch.color ?? s.annotationColor,
        annotationSize: patch.size ?? s.annotationSize,
        annotationFill: patch.fill ?? s.annotationFill,
        annotationDuration: patch.duration ?? s.annotationDuration,
      })),


    addZoomKeyframe: (clipId, timelineTime) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip) return;
      const t = Math.max(0, Math.min(clip.duration, timelineTime - clip.startTime));
      const keys = [...(clip.zoomKeyframes ?? []).filter((k) => Math.abs(k.time - t) > 0.05)];
      keys.push({ time: t, scale: 1.4, x: 0, y: 0 });
      keys.sort((a, b) => a.time - b.time);
      get().updateClip(clipId, { zoomKeyframes: keys });
    },

    removeZoomKeyframe: (clipId, index) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip) return;
      const keys = (clip.zoomKeyframes ?? []).filter((_, i) => i !== index);
      get().updateClip(clipId, { zoomKeyframes: keys });
    },

    /** Remove intervalos de tempo (cortador de silêncio) fechando os buracos. */
    cutRanges: (ranges) => {
      const ordered = [...ranges].filter((r) => r.end - r.start > 0.05).sort((a, b) => a.start - b.start);
      if (ordered.length === 0) return 0;
      // funde intervalos sobrepostos uma única vez (evita trabalho repetido)
      const merged: { start: number; end: number }[] = [];
      for (const r of ordered) {
        const last = merged[merged.length - 1];
        if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
        else merged.push({ start: r.start, end: r.end });
      }
      const captionsBefore = allClips(get().tracks).filter((c) => c.isCaption).length;

      write((tracks) =>
        mapTracks(tracks, (clips, track) => {
          if (track.type === "text") {
            const captions = clips.filter((c) => c.isCaption);
            if (captions.length === 0) return clips;
            const remapped = remapCaptionsAfterCuts(
              captions.map((c) => ({ clip: c, start: c.startTime, end: c.startTime + c.duration })),
              merged,
            ).map(({ clip, start, end }) => ({
              ...clip,
              startTime: start,
              duration: Math.max(0.2, end - start),
              sourceInEnd: Math.max(0.2, end - start),
            }));
            return [...clips.filter((c) => !c.isCaption), ...remapped];
          }
          if (track.type !== "video" && track.type !== "audio") return clips;
          /* Varredura linear: para cada clipe, percorre só os intervalos que o
             tocam (ponteiro avança) — evita o custo quadrático que travava a UI
             em vídeos longos com centenas de cortes. */
          const byStart = [...clips].sort((a, b) => a.startTime - b.startTime);
          const out: Clip[] = [];
          let ri = 0;
          for (const c of byStart) {
            const cs = c.startTime;
            const ce = cs + c.duration;
            const speed = c.speed ?? 1;
            while (ri > 0 && (merged[ri - 1]?.end ?? 0) > cs) ri--;
            while (ri < merged.length && (merged[ri]?.end ?? 0) <= cs) ri++;
            let cursor = cs;
            let k = ri;
            let first = true;
            while (k < merged.length && (merged[k]?.start ?? Infinity) < ce) {
              const r = merged[k]!;
              const segStart = cursor;
              const segEnd = Math.min(r.start, ce);
              const segDur = segEnd - segStart;
              if (segDur > MIN_CLIP) {
                const offset = segStart - cs;
                out.push({
                  ...c,
                  id: first ? c.id : uid(),
                  startTime: segStart,
                  duration: segDur,
                  sourceInStart: c.sourceInStart + offset * speed,
                  sourceInEnd: c.sourceInStart + (offset + segDur) * speed,
                });
                first = false;
              }
              cursor = Math.max(cursor, r.end);
              k++;
            }
            const tailDur = ce - cursor;
            if (cursor <= cs) {
              out.push(c);
            } else if (tailDur > MIN_CLIP) {
              const offset = cursor - cs;
              out.push({
                ...c,
                id: first ? c.id : uid(),
                startTime: cursor,
                duration: tailDur,
                sourceInStart: c.sourceInStart + offset * speed,
                sourceInEnd: c.sourceInStart + (offset + tailDur) * speed,
              });
            }
          }
          // fecha os buracos
          let cursor = 0;
          return out.map((c) => {
            const clip = { ...c, startTime: cursor };
            cursor += c.duration;
            return clip;
          });
        }),

      );
      const prev = get().removedRanges;
      const inOriginal = merged.map((r) => ({
        start: toOriginalTime(r.start, prev),
        end: toOriginalTime(r.end, prev),
      }));
      set({
        selectedClipId: null,
        selectedClipIds: [],
        silences: [],
        removedRanges: [...prev, ...inOriginal].sort((a, b) => a.start - b.start),
      });
      return captionsBefore;
    },


    setSourceBlob: (sourceBlob) => set({ sourceBlob }),
    setSilences: (silences) => set({ silences }),

    addCaptionClips: (rawSegments, words) => {
      const style = get().captionStyle;
      const preset = BLOCK_PRESETS[style.blockSize ?? "medio"];
      // reagrupa em blocos curtos (pausas reais da fala) antes de qualquer remap
      const chunked = words?.length
        ? chunkCaptionWords(words, preset)
        : chunkSegmentsByText(rawSegments, preset);
      console.info(
        `[legendas] chunking (${style.blockSize ?? "medio"}): ${rawSegments.length} segmentos + ${
          words?.length ?? 0
        } palavras → ${chunked.length} blocos`,
      );
      // sem fallback silencioso para "um bloco cobrindo tudo": erro visível
      if (chunked.length === 0) {
        throw new Error(
          "Não foi possível transcrever este áudio — tente novamente ou verifique se há fala audível no vídeo.",
        );
      }
      const base = chunked;
      // legendas vêm do áudio original: aplica os cortes já feitos
      const removed = get().removedRanges;
      const segments = removed.length ? remapCaptionsAfterCuts(base, removed) : base;
      const clips: Clip[] = segments
        .filter((s) => s.text.trim() && s.end - s.start > 0.05)
        .map((s) => ({
          id: uid(),
          trackId: TEXT_TRACK,
          type: "text" as const,
          sourceUrl: "",
          startTime: Math.max(0, s.start),
          duration: Math.max(0.2, s.end - s.start),
          sourceInStart: 0,
          sourceInEnd: Math.max(0.2, s.end - s.start),
          textContent: s.text.trim(),
          fontSize: style.fontSize,
          color: style.color,
          background: style.background,
          position: { x: 0.5, y: captionY(style.place) },
          isCaption: true,
        }));
      if (clips.length === 0) return;
      write((tracks) =>
        mapTracks(tracks, (existing, track) =>
          track.id === TEXT_TRACK ? [...existing.filter((c) => !c.isCaption), ...clips] : existing,
        ),
      );
    },


    setCaptionStyle: (patch) => {
      const style = { ...get().captionStyle, ...patch };
      set({ captionStyle: style });
      write((tracks) =>
        mapTracks(tracks, (clips) =>
          clips.map((c) =>
            c.isCaption
              ? {
                  ...c,
                  fontSize: style.fontSize,
                  color: style.color,
                  background: style.background,
                  position: { x: c.position?.x ?? 0.5, y: captionY(style.place) },
                }
              : c,
          ),
        ),
      );
    },

    clearCaptions: () =>
      write((tracks) => mapTracks(tracks, (clips) => clips.filter((c) => !c.isCaption))),

    setTransition: (clipId, patch) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip) return;
      get().updateClip(clipId, {
        transition: patch.kind ?? clip.transition ?? "none",
        transitionDuration: Math.max(
          0.1,
          Math.min(2, patch.duration ?? clip.transitionDuration ?? DEFAULT_TRANSITION_DURATION),
        ),
        transitionDir: patch.dir ?? clip.transitionDir ?? "left",
      });
    },

    /* ---------------------- keyframes ---------------------- */

    addKeyframeAt: (clipId, prop) => {
      const clip = findClip(get().tracks, clipId);
      const meta = propByKey(prop);
      if (!clip || !meta) return;
      const local = Math.max(0, Math.min(clip.duration, get().currentTime - clip.startTime));
      const value = meta.get(resolveClip(clip, get().currentTime));
      const keys = clip.keyframes?.[prop] ?? [];
      const map: KeyframeMap = { ...(clip.keyframes ?? {}), [prop]: upsertKeyframe(keys, local, value) };
      get().updateClip(clipId, { keyframes: map });
    },

    setKeyframeValue: (clipId, prop, kfId, value, live) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip?.keyframes?.[prop]) return;
      const touched = clip.keyframes[prop].find((k) => k.id === kfId);
      const map: KeyframeMap = {
        ...clip.keyframes,
        [prop]: clip.keyframes[prop].map((k) => (k.id === kfId ? { ...k, value } : k)),
      };
      const presets = touched?.origin
        ? (clip.effectPresets ?? []).map((p) =>
            p.id === touched.origin ? { ...p, edited: true } : p,
          )
        : clip.effectPresets;
      (live ? get().updateClipLive : get().updateClip)(clipId, {
        keyframes: map,
        ...(presets ? { effectPresets: presets } : {}),
      });
    },



    togglePropertyAnimation: (clipId, prop) => {
      const clip = findClip(get().tracks, clipId);
      const meta = propByKey(prop);
      if (!clip || !meta) return;
      const map: KeyframeMap = { ...(clip.keyframes ?? {}) };
      if ((map[prop]?.length ?? 0) > 0) {
        // desliga: congela o valor atual e remove todos os keyframes
        delete map[prop];
        get().updateClip(clipId, { keyframes: map, ...meta.set(meta.get(clip)) });
      } else {
        const local = Math.max(0, Math.min(clip.duration, get().currentTime - clip.startTime));
        map[prop] = [newKeyframe(local, meta.get(clip))];
        get().updateClip(clipId, { keyframes: map });
      }
      set({ selectedKeyframes: [] });
    },

    setPropValue: (clipId, prop, value, live) => {
      const clip = findClip(get().tracks, clipId);
      const meta = propByKey(prop);
      if (!clip || !meta) return;
      const apply = live ? get().updateClipLive : get().updateClip;
      const keys = clip.keyframes?.[prop];
      if (!keys || keys.length === 0) {
        apply(clipId, meta.set(value));
        return;
      }
      const local = Math.max(0, Math.min(clip.duration, get().currentTime - clip.startTime));
      const map: KeyframeMap = { ...(clip.keyframes ?? {}), [prop]: upsertKeyframe(keys, local, value) };
      apply(clipId, { keyframes: map, ...meta.set(value) });
    },

    moveKeyframes: (clipId, moves, live) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip || moves.length === 0) return;
      const map: KeyframeMap = { ...(clip.keyframes ?? {}) };
      for (const m of moves) {
        const keys = map[m.prop];
        if (!keys) continue;
        map[m.prop] = sortKeys(
          keys.map((k) =>
            k.id === m.kfId
              ? { ...k, time: Math.max(0, Math.min(clip.duration, m.time)) }
              : k,
          ),
        );
      }
      (live ? get().updateClipLive : get().updateClip)(clipId, { keyframes: map });
    },

    setKeyframeEasing: (clipId, prop, kfId, easing) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip?.keyframes?.[prop]) return;
      const map: KeyframeMap = {
        ...clip.keyframes,
        [prop]: clip.keyframes[prop].map((k) => (k.id === kfId ? { ...k, easing } : k)),
      };
      get().updateClip(clipId, { keyframes: map });
    },

    setKeyframeSpeed: (clipId, prop, kfId, patch, live) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip?.keyframes?.[prop]) return;
      const map: KeyframeMap = {
        ...clip.keyframes,
        [prop]: clip.keyframes[prop].map((k) => {
          if (k.id !== kfId) return k;
          const next: Keyframe = {
            ...k,
            easing: "custom",
            continuous: patch.continuous ?? k.continuous,
            incomingSpeed: {
              x: 0,
              y: 0,
              influence: 33.33,
              ...k.incomingSpeed,
              ...patch.incomingSpeed,
            },
            outgoingSpeed: {
              x: 0,
              y: 0,
              influence: 33.33,
              ...k.outgoingSpeed,
              ...patch.outgoingSpeed,
            },
          };
          return applyContinuity(next);
        }),
      };
      (live ? get().updateClipLive : get().updateClip)(clipId, { keyframes: map });
    },

    setTextPreset: (clipId, side, cfg) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip) return;
      const current: PresetConfig = {
        preset: "none",
        duration: 0.5,
        speed: 100,
        ...(side === "in" ? clip.animIn : clip.animOut),
        ...cfg,
      };
      const next: Clip = { ...clip, ...(side === "in" ? { animIn: current } : { animOut: current }) };
      const keyframes =
        current.preset === "none"
          ? stripPreset({ ...(clip.keyframes ?? {}) }, side)
          : applyPreset(next, side, current);
      const inPreset: PresetId = (side === "in" ? current.preset : next.animIn?.preset) ?? "none";
      const outPreset: PresetId = (side === "out" ? current.preset : next.animOut?.preset) ?? "none";
      get().updateClip(clipId, {
        ...(side === "in" ? { animIn: current } : { animOut: current }),
        keyframes,
        revealMode: revealModeFor(inPreset, outPreset),
      });
    },

    /* ---------------- efeitos com janela própria (modo Simples) ------- */

    applyEffectPreset: (clipId, presetId, params) => {
      const clip = findClip(get().tracks, clipId);
      const def = presetById(presetId);
      if (!clip || !def) return;
      const merged: PresetParams = { ...params };
      const id = `fx-${uid()}`;
      const playhead = get().currentTime;
      const clipEnd = clip.startTime + clip.duration;
      const win = naturalWindow(def, merged);
      const start =
        def.category === "out"
          ? Math.max(0, clipEnd - win)
          : Math.max(clip.startTime, Math.min(clipEnd - 0.05, playhead));
      const end = def.category === "out" ? clipEnd : start + win;

      const fx: TimelineEffect = {
        id,
        presetId,
        category: def.category,
        params: merged,
        start,
        end,
        targetType: clip.type,
        label: def.label,
      };
      const effects = [...get().effects, fx];
      set({
        effects,
        tracks: applyEffectsToTracks(get().tracks, effects),
        pendingEffectPreset: null,
        selectedKeyframes: [],
        selectedEffectId: id,
      });
    },

    updateEffectPresetParams: (_clipId, effectId, params) => {
      const effects = get().effects.map((e) =>
        e.id === effectId ? { ...e, params: { ...e.params, ...params } } : e,
      );
      set({ effects, tracks: applyEffectsToTracks(get().tracks, effects) });
    },

    removeEffectPreset: (_clipId, effectId) => {
      const effects = get().effects.filter((e) => e.id !== effectId);
      set({
        effects,
        tracks: applyEffectsToTracks(get().tracks, effects),
        selectedKeyframes: [],
        selectedEffectId: get().selectedEffectId === effectId ? null : get().selectedEffectId,
      });
    },

    moveEffect: (effectId, start) => {
      const effects = get().effects.map((e) => {
        if (e.id !== effectId) return e;
        const len = e.end - e.start;
        const s = Math.max(0, start);
        return { ...e, start: s, end: s + len };
      });
      set({ effects, tracks: applyEffectsToTracks(get().tracks, effects) });
    },

    resizeEffect: (effectId, start, end) => {
      const effects = get().effects.map((e) => {
        if (e.id !== effectId) return e;
        const s = Math.max(0, Math.min(start, end - 0.2));
        return { ...e, start: s, end: Math.max(s + 0.2, end) };
      });
      set({ effects, tracks: applyEffectsToTracks(get().tracks, effects) });
    },

    selectEffect: (effectId) => set({ selectedEffectId: effectId }),

    setPendingEffectPreset: (value) => set({ pendingEffectPreset: value }),

    setEffectPoint: (effectId, point) => {
      const effects = get().effects.map((e) =>
        e.id === effectId ? { ...e, params: { ...e.params, point } } : e,
      );
      set({
        effects,
        tracks: applyEffectsToTracks(get().tracks, effects),
        pendingEffectPreset: null,
        selectedEffectId: effectId,
      });
    },





    removeKeyframe: (clipId, prop, kfId) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip?.keyframes?.[prop]) return;
      const map: KeyframeMap = { ...clip.keyframes };
      const rest = map[prop].filter((k) => k.id !== kfId);
      if (rest.length === 0) delete map[prop];
      else map[prop] = rest;
      get().updateClip(clipId, { keyframes: map });
      set((s) => ({ selectedKeyframes: s.selectedKeyframes.filter((k) => k.kfId !== kfId) }));
    },

    removeSelectedKeyframes: () => {
      const { selectedClipId, selectedKeyframes } = get();
      const clip = findClip(get().tracks, selectedClipId);
      if (!clip || selectedKeyframes.length === 0) return;
      const map: KeyframeMap = { ...(clip.keyframes ?? {}) };
      for (const sel of selectedKeyframes) {
        const keys = map[sel.prop];
        if (!keys) continue;
        const rest = keys.filter((k) => k.id !== sel.kfId);
        if (rest.length === 0) delete map[sel.prop];
        else map[sel.prop] = rest;
      }
      get().updateClip(clip.id, { keyframes: map });
      set({ selectedKeyframes: [] });
    },

    selectKeyframe: (prop, kfId, additive) =>
      set((s) => {
        const has = s.selectedKeyframes.some((k) => k.kfId === kfId);
        if (!additive) return { selectedKeyframes: [{ prop, kfId }] };
        return {
          selectedKeyframes: has
            ? s.selectedKeyframes.filter((k) => k.kfId !== kfId)
            : [...s.selectedKeyframes, { prop, kfId }],
        };
      }),

    selectKeyframes: (list, additive) =>
      set((s) => {
        if (!additive) return { selectedKeyframes: list };
        const merged = [...s.selectedKeyframes];
        for (const item of list) {
          if (!merged.some((k) => k.kfId === item.kfId)) merged.push(item);
        }
        return { selectedKeyframes: merged };
      }),

    clearKeyframeSelection: () => set({ selectedKeyframes: [] }),

    setKeyframeTime: (clipId, prop, kfId, time) => {
      get().moveKeyframes(clipId, [{ prop, kfId, time }]);
    },

    nudgeSelectedKeyframes: (delta) => {
      const { selectedClipId, selectedKeyframes } = get();
      const clip = findClip(get().tracks, selectedClipId);
      if (!clip || selectedKeyframes.length === 0) return;
      const moves = selectedKeyframes.flatMap((sel) => {
        const kf = clip.keyframes?.[sel.prop]?.find((k) => k.id === sel.kfId);
        return kf ? [{ prop: sel.prop, kfId: sel.kfId, time: kf.time + delta }] : [];
      });
      get().moveKeyframes(clip.id, moves);
    },

    copySelectedKeyframes: () => {
      const { selectedClipId, selectedKeyframes } = get();
      const clip = findClip(get().tracks, selectedClipId);
      if (!clip || selectedKeyframes.length === 0) return;
      const picked = selectedKeyframes.flatMap((sel) => {
        const kf = clip.keyframes?.[sel.prop]?.find((k) => k.id === sel.kfId);
        return kf ? [{ prop: sel.prop, time: kf.time, value: kf.value, easing: kf.easing }] : [];
      });
      if (picked.length === 0) return;
      const base = Math.min(...picked.map((k) => k.time));
      set({
        kfClipboard: picked.map((k) => ({
          prop: k.prop,
          offset: k.time - base,
          value: k.value,
          easing: k.easing,
        })),
      });
    },

    pasteKeyframes: () => {
      const { selectedClipId, kfClipboard, currentTime } = get();
      const clip = findClip(get().tracks, selectedClipId);
      if (!clip || kfClipboard.length === 0) return;
      const at = Math.max(0, Math.min(clip.duration, currentTime - clip.startTime));
      const map: KeyframeMap = { ...(clip.keyframes ?? {}) };
      const created: { prop: string; kfId: string }[] = [];
      for (const item of kfClipboard) {
        const time = Math.max(0, Math.min(clip.duration, at + item.offset));
        const kf = newKeyframe(time, item.value, item.easing);
        const keys = (map[item.prop] ?? []).filter((k) => Math.abs(k.time - time) > KF_EPS / 2);
        map[item.prop] = sortKeys([...keys, kf]);
        created.push({ prop: item.prop, kfId: kf.id });
      }
      get().updateClip(clip.id, { keyframes: map });
      set({ selectedKeyframes: created });
    },

    cycleKeyframeRows: (all) =>
      set((s) => {
        const target = all ? "all" : "animated";
        return { kfExpanded: s.kfExpanded === target ? "none" : target };
      }),


    undo: () =>
      set((s) => {
        const prev = s.past[s.past.length - 1];
        if (!prev) return s;
        return {
          tracks: prev,
          past: s.past.slice(0, -1),
          future: [s.tracks, ...s.future].slice(0, 50),
          duration: timelineDuration(prev),
        };
      }),

    redo: () =>
      set((s) => {
        const next = s.future[0];
        if (!next) return s;
        return {
          tracks: next,
          past: [...s.past, s.tracks],
          future: s.future.slice(1),
          duration: timelineDuration(next),
        };
      }),

    commit: () => snapshot(),
  };
});

/** Clipe de vídeo sob o playhead. */
export function clipAt(tracks: Track[], type: TrackType, time: number): Clip | null {
  const track = tracks.find((t) => t.type === type);
  if (!track) return null;
  return (
    track.clips.find((c) => time >= c.startTime && time < c.startTime + c.duration) ?? null
  );
}

export function clipsAt(tracks: Track[], type: TrackType, time: number): Clip[] {
  const track = tracks.find((t) => t.type === type);
  if (!track) return [];
  return track.clips.filter((c) => time >= c.startTime && time < c.startTime + c.duration);
}

/** Interpola os keyframes de zoom no tempo local do clipe. */
export function zoomAt(clip: Clip, localTime: number) {
  // caminho unificado: zoom agora é uma propriedade animável comum
  const kf = clip.keyframes?.zoom;
  if (kf && kf.length > 0) {
    const v = valueAt(kf, localTime);
    return { time: localTime, scale: typeof v === "number" ? v : 1, x: 0, y: 0 };
  }
  if (!clip.keyframes?.zoom && typeof clip.zoom === "number" && clip.zoom !== 1) {
    return { time: localTime, scale: clip.zoom, x: 0, y: 0 };
  }
  const keys = clip.zoomKeyframes ?? [];
  if (keys.length === 0) return { scale: 1, x: 0, y: 0 };
  if (keys.length === 1) return keys[0];
  if (localTime <= keys[0].time) return keys[0];
  const last = keys[keys.length - 1];
  if (localTime >= last.time) return last;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (localTime >= a.time && localTime <= b.time) {
      const raw = (localTime - a.time) / Math.max(0.001, b.time - a.time);
      const p = raw * raw * (3 - 2 * raw); // easing suave
      return {
        time: localTime,
        scale: a.scale + (b.scale - a.scale) * p,
        x: a.x + (b.x - a.x) * p,
        y: a.y + (b.y - a.y) * p,
      };
    }
  }
  return last;
}

/* Exposto apenas em desenvolvimento para depuração/testes automatizados. */
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __editor?: typeof useEditor }).__editor = useEditor;
}

// acesso ao store no console durante o desenvolvimento (ajuda a depurar a timeline)
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __editor?: typeof useEditor }).__editor = useEditor;
}
