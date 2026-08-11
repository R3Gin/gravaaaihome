import { create } from "zustand";

/* ------------------------------------------------------------------ *
 * Estado central do editor. Toda interação (cortar, arrastar, trim,
 * deletar, selecionar) passa por aqui — timeline, preview e painéis
 * leem sempre a mesma fonte de verdade.
 * ------------------------------------------------------------------ */

export type TrackType = "video" | "audio" | "text" | "overlay";
export type TransitionKind = "none" | "fade" | "slide";

export interface ZoomKeyframe {
  time: number; // segundos, relativo ao início do clipe na timeline
  scale: number;
  x: number;
  y: number;
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
  transition?: TransitionKind;
  denoise?: boolean;
  zoomKeyframes?: ZoomKeyframe[];
  position?: { x: number; y: number };
  // texto
  textContent?: string;
  fontSize?: number;
  color?: string;
  background?: boolean;
  // overlay
  overlayKind?: "blur" | "spotlight";
  rect?: { x: number; y: number; w: number; h: number };
  strength?: number;
}

export interface Track {
  id: string;
  type: TrackType;
  label: string;
  clips: Clip[];
}

export type AspectRatio = "16:9" | "9:16" | "1:1";
export type Tool = "select" | "blade";

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
  tracks: Track[];
  past: Track[][];
  future: Track[][];
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
  updateClip: (id: string, patch: Partial<Clip>) => void;
  splitAt: (clipId: string, time: number) => void;
  splitPlayhead: () => void;
  removeClip: (id: string) => void;
  duplicateClip: (id: string) => void;
  moveClip: (id: string, newStart: number) => void;
  trimClip: (id: string, side: "start" | "end", newTime: number) => void;
  addTextClip: (text?: string) => void;
  addOverlayClip: (kind: "blur" | "spotlight") => void;
  addZoomKeyframe: (clipId: string, timelineTime: number) => void;
  removeZoomKeyframe: (clipId: string, index: number) => void;
  cutRanges: (ranges: { start: number; end: number }[]) => void;
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
  return [
    { id: VIDEO_TRACK, type: "video", label: "Vídeo", clips: [] },
    { id: OVERLAY_TRACK, type: "overlay", label: "Efeitos", clips: [] },
    { id: TEXT_TRACK, type: "text", label: "Texto", clips: [] },
    { id: AUDIO_TRACK, type: "audio", label: "Áudio", clips: [] },
  ];
}

export function allClips(tracks: Track[]): Clip[] {
  return tracks.flatMap((t) => t.clips);
}

export function findClip(tracks: Track[], id: string | null): Clip | null {
  if (!id) return null;
  for (const t of tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return c;
  }
  return null;
}

export function timelineDuration(tracks: Track[]): number {
  return allClips(tracks).reduce((m, c) => Math.max(m, c.startTime + c.duration), 0);
}

/** Empurra vizinhos para a direita para impedir sobreposição na mesma faixa. */
function resolveOverlaps(clips: Clip[], movedId: string): Clip[] {
  const sorted = [...clips].sort((a, b) => {
    if (Math.abs(a.startTime - b.startTime) < 0.0001) return a.id === movedId ? -1 : 1;
    return a.startTime - b.startTime;
  });
  let cursor = -Infinity;
  return sorted.map((c) => {
    const start = Math.max(c.startTime, cursor);
    cursor = start + c.duration;
    return start === c.startTime ? c : { ...c, startTime: start };
  });
}

function mapTracks(tracks: Track[], fn: (clips: Clip[], track: Track) => Clip[]): Track[] {
  return tracks.map((t) => ({ ...t, clips: fn(t.clips, t) }));
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
    tracks: emptyTracks(),
    past: [],
    future: [],

    loadSource: (url, duration, size, name) => {
      const tracks = emptyTracks();
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
      };
      tracks[0].clips = [clip];
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
        past: [],
        future: [],
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
        past: [],
        future: [],
      }),

    setProjectName: (projectName) => set({ projectName }),
    setCurrentTime: (t) => set({ currentTime: Math.max(0, t) }),
    setPlaying: (playing) => set({ playing }),
    setZoom: (z) => set({ zoom: Math.min(400, Math.max(10, z)) }),
    setAspect: (aspect) => set({ aspect }),
    setTool: (tool) => set({ tool }),
    select: (selectedClipId) => set({ selectedClipId }),

    updateClip: (id, patch) =>
      write((tracks) =>
        mapTracks(tracks, (clips) => clips.map((c) => (c.id === id ? { ...c, ...patch } : c))),
      ),

    splitAt: (clipId, time) => {
      const clip = findClip(get().tracks, clipId);
      if (!clip) return;
      const local = time - clip.startTime;
      if (local < MIN_CLIP || clip.duration - local < MIN_CLIP) return;
      const speed = clip.speed ?? 1;
      const cutSource = clip.sourceInStart + local * speed;
      const a: Clip = { ...clip, duration: local, sourceInEnd: cutSource };
      const b: Clip = {
        ...clip,
        id: uid(),
        startTime: clip.startTime + local,
        duration: clip.duration - local,
        sourceInStart: cutSource,
        transition: "none",
      };
      write((tracks) =>
        mapTracks(tracks, (clips) =>
          clips.flatMap((c) => (c.id === clipId ? [a, b] : [c])),
        ),
      );
      set({ selectedClipId: b.id });
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
      write((tracks) => mapTracks(tracks, (clips) => clips.filter((c) => c.id !== id)));
      if (get().selectedClipId === id) set({ selectedClipId: null });
    },

    duplicateClip: (id) => {
      const clip = findClip(get().tracks, id);
      if (!clip) return;
      const copy: Clip = { ...clip, id: uid(), startTime: clip.startTime + clip.duration };
      write((tracks) =>
        mapTracks(tracks, (clips, track) =>
          track.id === clip.trackId ? resolveOverlaps([...clips, copy], copy.id) : clips,
        ),
      );
      set({ selectedClipId: copy.id });
    },

    moveClip: (id, newStart) => {
      const clip = findClip(get().tracks, id);
      if (!clip) return;
      write((tracks) =>
        mapTracks(tracks, (clips, track) => {
          if (track.id !== clip.trackId) return clips;
          const moved = clips.map((c) =>
            c.id === id ? { ...c, startTime: Math.max(0, newStart) } : c,
          );
          return resolveOverlaps(moved, id);
        }),
      );
    },

    trimClip: (id, side, newTime) => {
      const clip = findClip(get().tracks, id);
      if (!clip) return;
      const speed = clip.speed ?? 1;
      let patch: Partial<Clip> = {};
      if (side === "start") {
        const maxStart = clip.startTime + clip.duration - MIN_CLIP;
        const start = Math.max(0, Math.min(newTime, maxStart));
        const delta = start - clip.startTime;
        const sourceInStart = Math.max(0, clip.sourceInStart + delta * speed);
        patch = {
          startTime: start,
          duration: clip.duration - delta,
          sourceInStart,
        };
      } else {
        const end = Math.max(clip.startTime + MIN_CLIP, newTime);
        const duration = end - clip.startTime;
        const sourceInEnd = Math.min(
          get().sourceDuration || Infinity,
          clip.sourceInStart + duration * speed,
        );
        patch = { duration: (sourceInEnd - clip.sourceInStart) / speed, sourceInEnd };
      }
      write((tracks) =>
        mapTracks(tracks, (clips, track) => {
          if (track.id !== clip.trackId) return clips;
          return resolveOverlaps(
            clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
            id,
          );
        }),
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
      set({ selectedClipId: clip.id });
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
      set({ selectedClipId: clip.id });
    },

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
      if (ordered.length === 0) return;
      write((tracks) =>
        mapTracks(tracks, (clips, track) => {
          if (track.type !== "video" && track.type !== "audio") return clips;
          let out: Clip[] = clips;
          for (const r of ordered) {
            const next: Clip[] = [];
            for (const c of out) {
              const cs = c.startTime;
              const ce = c.startTime + c.duration;
              if (r.end <= cs || r.start >= ce) {
                next.push(c);
                continue;
              }
              const speed = c.speed ?? 1;
              const headDur = Math.max(0, r.start - cs);
              const tailStart = Math.max(cs, r.end);
              const tailDur = Math.max(0, ce - tailStart);
              if (headDur > MIN_CLIP) {
                next.push({
                  ...c,
                  duration: headDur,
                  sourceInEnd: c.sourceInStart + headDur * speed,
                });
              }
              if (tailDur > MIN_CLIP) {
                const offset = tailStart - cs;
                next.push({
                  ...c,
                  id: uid(),
                  startTime: tailStart,
                  duration: tailDur,
                  sourceInStart: c.sourceInStart + offset * speed,
                });
              }
            }
            out = next;
          }
          // fecha os buracos
          const sorted = [...out].sort((a, b) => a.startTime - b.startTime);
          let cursor = 0;
          return sorted.map((c) => {
            const clip = { ...c, startTime: cursor };
            cursor += c.duration;
            return clip;
          });
        }),
      );
      set({ selectedClipId: null });
    },

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
