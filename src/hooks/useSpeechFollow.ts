// Hook de acompanhamento de fala do Teleprompter.
// Usa SpeechRecognition nativo (pt-BR) e devolve apenas o índice do segmento
// atual + um estado de escuta — nada de rerender por palavra.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceCursor,
  normalizeWord,
  segmentAtCursor,
  supportsSpeechRecognition,
  type ScriptModel,
} from "@/lib/speech-follow";

export type ListenState = "idle" | "listening" | "following" | "waiting";

const SILENCE_MS = 1800;

export function useSpeechFollow(model: ScriptModel, enabled: boolean) {
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [listenState, setListenState] = useState<ListenState>("idle");
  const [unsupported, setUnsupported] = useState(false);

  const cursorRef = useRef(0);
  const recRef = useRef<any>(null);
  const stoppedRef = useRef(true);
  const modelRef = useRef(model);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Quantas palavras já consumimos de cada resultado interino em andamento.
  const consumedRef = useRef(0);
  const resultIndexRef = useRef(-1);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  const applyCursor = useCallback((next: number) => {
    cursorRef.current = next;
    const seg = segmentAtCursor(modelRef.current.segments, next);
    setSegmentIndex((prev) => (prev === seg ? prev : seg));
  }, []);

  /** Permite avanço/retrocesso manual mesmo com a voz ativa. */
  const stepSegment = useCallback((dir: 1 | -1) => {
    const segments = modelRef.current.segments;
    if (!segments.length) return;
    setSegmentIndex((prev) => {
      const next = Math.max(0, Math.min(segments.length - 1, prev + dir));
      cursorRef.current = segments[next]!.start;
      return next;
    });
  }, []);

  const resetFollow = useCallback(() => {
    cursorRef.current = 0;
    consumedRef.current = 0;
    resultIndexRef.current = -1;
    setSegmentIndex(0);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setListenState("idle");
      return;
    }
    if (!supportsSpeechRecognition()) {
      setUnsupported(true);
      return;
    }
    setUnsupported(false);

    const Ctor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    recRef.current = rec;
    stoppedRef.current = false;

    const markWaiting = () => setListenState("waiting");
    const bumpSilence = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(markWaiting, SILENCE_MS);
    };

    rec.onstart = () => setListenState("listening");
    rec.onerror = (e: any) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        stoppedRef.current = true;
        setUnsupported(true);
      }
    };
    rec.onend = () => {
      if (!stoppedRef.current) {
        try {
          rec.start();
        } catch {
          /* já reiniciando */
        }
      } else {
        setListenState("idle");
      }
    };
    rec.onresult = (event: any) => {
      const last = event.results[event.results.length - 1];
      const idx = event.results.length - 1;
      if (idx !== resultIndexRef.current) {
        resultIndexRef.current = idx;
        consumedRef.current = 0;
      }
      const words = String(last[0]?.transcript ?? "")
        .split(/\s+/)
        .map(normalizeWord)
        .filter(Boolean);
      const fresh = words.slice(consumedRef.current);
      if (last.isFinal) {
        consumedRef.current = 0;
        resultIndexRef.current = -1;
      } else {
        consumedRef.current = words.length;
      }
      if (fresh.length) {
        applyCursor(advanceCursor(modelRef.current.words, cursorRef.current, fresh));
        setListenState("following");
      }
      bumpSilence();
    };

    try {
      rec.start();
    } catch {
      /* já ativo */
    }

    return () => {
      stoppedRef.current = true;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      try {
        rec.stop();
      } catch {
        /* noop */
      }
      recRef.current = null;
      setListenState("idle");
    };
  }, [enabled, applyCursor]);

  return { segmentIndex, listenState, unsupported, stepSegment, resetFollow };
}
