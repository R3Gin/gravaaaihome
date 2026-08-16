// Acompanhamento de fala do Teleprompter.
//
// Arquitetura (auditada):
//  - o SpeechRecognition vive SEMPRE na janela principal (este hook), nunca na
//    janela Document PiP. A PiP só renderiza o estado via portal do React, ou
//    seja, há uma única fonte de verdade (segmentIndex/wordCursor).
//  - a instância é criada UMA vez por ativação, guardada em ref, e os callbacks
//    leem tudo por ref (sem stale closure) — nenhum start/stop por render.
//  - onend reinicia sozinho enquanto o modo por voz estiver ligado (Chrome
//    encerra o reconhecimento por conta própria, inclusive quando o foco vai
//    para a janela PiP), com backoff e sem loop em erro de permissão.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  alignCursor,
  normalizeText,
  segmentAtCursor,
  supportsSpeechRecognition,
  type ScriptModel,
} from "@/lib/speech-follow";

export type ListenState =
  | "idle"
  | "starting"
  | "listening"
  | "hearing"
  | "following"
  | "waiting"
  | "error";

export type VoiceErrorCode = "unsupported" | "not-allowed" | "audio-capture" | "unknown";

const SILENCE_MS = 2500;
/** Palavras recentes consideradas para o matching. */
const RECENT_WORDS = 40;
/** Avanço máximo aceito sem confirmação (em palavras). */
const MAX_JUMP = 8;
/** Sem casamento por este tempo → amplia a janela de busca (anti-travamento). */
const STALL_MS = 4000;
/** Janela ampliada usada no resgate. */
const RESCUE_REACH = 45;
const LOG = "[Teleprompter Voice]";


export function useSpeechFollow(model: ScriptModel, enabled: boolean) {
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [wordCursor, setWordCursor] = useState(0);
  const [listenState, setListenState] = useState<ListenState>("idle");
  const [errorCode, setErrorCode] = useState<VoiceErrorCode | null>(null);

  const cursorRef = useRef(0);
  const recRef = useRef<any>(null);
  const manualStopRef = useRef(true);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelRef = useRef(model);
  /** Palavras já finalizadas pelo reconhecedor (acumuladas). */
  const finalWordsRef = useRef<string[]>([]);
  /** Índice do primeiro result ainda não consolidado como final. */
  const finalizedUpToRef = useRef(0);
  /** Última posição confirmada por um resultado final. */
  const committedCursorRef = useRef(0);
  /** Salto grande aguardando confirmação. */
  const pendingJumpRef = useRef<number | null>(null);
  /** Momento do último casamento aceito. */
  const lastMatchAtRef = useRef(0);


  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  const applyCursor = useCallback((next: number) => {
    cursorRef.current = next;
    setWordCursor(next);
    const seg = segmentAtCursor(modelRef.current.segments, next);
    setSegmentIndex((prev) => {
      if (prev !== seg) console.log(`${LOG} current segment:`, seg, "(word cursor", next + ")");
      return prev === seg ? prev : seg;
    });
  }, []);

  /** Avanço/retrocesso manual, mesmo com a voz ativa. */
  const stepSegment = useCallback((dir: 1 | -1) => {
    const segments = modelRef.current.segments;
    if (!segments.length) return;
    setSegmentIndex((prev) => {
      const next = Math.max(0, Math.min(segments.length - 1, prev + dir));
      cursorRef.current = segments[next]!.start;
      setWordCursor(segments[next]!.start);
      return next;
    });
  }, []);

  const resetFollow = useCallback(() => {
    cursorRef.current = 0;
    finalWordsRef.current = [];
    finalizedUpToRef.current = 0;
    committedCursorRef.current = 0;
    pendingJumpRef.current = null;
    lastMatchAtRef.current = performance.now();
    setWordCursor(0);
    setSegmentIndex(0);
  }, []);


  useEffect(() => {
    if (!enabled) {
      setListenState("idle");
      return;
    }
    if (!supportsSpeechRecognition()) {
      console.warn(`${LOG} SpeechRecognition indisponível neste navegador`);
      setErrorCode("unsupported");
      setListenState("error");
      return;
    }

    setErrorCode(null);
    setListenState("starting");

    const Ctor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    recRef.current = rec;
    manualStopRef.current = false;
    finalWordsRef.current = [];
    finalizedUpToRef.current = 0;

    const bumpSilence = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => setListenState("waiting"), SILENCE_MS);
    };

    const safeStart = () => {
      if (manualStopRef.current) return;
      try {
        rec.start();
      } catch (err) {
        // InvalidStateError = já está rodando; qualquer outro caso, tenta de novo.
        if ((err as Error)?.name !== "InvalidStateError") {
          console.warn(`${LOG} start falhou, tentando de novo:`, err);
          restartTimerRef.current = setTimeout(safeStart, 400);
        }
      }
    };

    rec.onstart = () => {
      console.log(`${LOG} recognition started`);
      setListenState("listening");
    };
    rec.onaudiostart = () => console.log(`${LOG} audio start`);
    rec.onspeechstart = () => {
      console.log(`${LOG} speech start`);
      setListenState((s) => (s === "following" ? s : "hearing"));
    };
    rec.onspeechend = () => console.log(`${LOG} speech end`);

    rec.onerror = (e: any) => {
      const code = String(e?.error ?? "unknown");
      console.warn(`${LOG} recognition error:`, code);
      if (code === "not-allowed" || code === "service-not-allowed") {
        manualStopRef.current = true;
        setErrorCode("not-allowed");
        setListenState("error");
      } else if (code === "audio-capture") {
        manualStopRef.current = true;
        setErrorCode("audio-capture");
        setListenState("error");
      }
      // no-speech / aborted / network: onend cuida do restart.
    };

    rec.onend = () => {
      console.log(`${LOG} recognition ended (manual:`, manualStopRef.current + ")");
      if (manualStopRef.current) {
        setListenState((s) => (s === "error" ? s : "idle"));
        return;
      }
      // O Chrome encerra sozinho (silêncio, perda de foco para a janela PiP…).
      restartTimerRef.current = setTimeout(safeStart, 250);
    };

    rec.onresult = (event: any) => {
      // Reconstrói final + interim corretamente, sem sobrescrever o histórico.
      let interim = "";
      let newFinal = "";
      let sawFinal = false;
      for (let i = finalizedUpToRef.current; i < event.results.length; i++) {
        const res = event.results[i];
        const alt = res[0];
        const text = String(alt?.transcript ?? "");
        if (res.isFinal) {
          // Filtro de ruído: alternativa de confiança muito baixa é descartada.
          if (typeof alt?.confidence === "number" && alt.confidence > 0 && alt.confidence < 0.25) {
            finalizedUpToRef.current = i + 1;
            continue;
          }
          newFinal += " " + text;
          finalizedUpToRef.current = i + 1;
          sawFinal = true;
        } else {
          interim += " " + text;
        }
      }
      if (newFinal.trim()) finalWordsRef.current.push(...normalizeText(newFinal));
      const spoken = [...finalWordsRef.current, ...normalizeText(interim)];
      const recent = spoken.slice(-RECENT_WORDS);
      if (!recent.length) return;
      // Ruído: uma única palavra curta não move nada.
      if (recent.length === 1 && recent[0]!.length < 4) return;

      console.log(`${LOG} result:`, recent.slice(-8).join(" "));

      const stalled = performance.now() - lastMatchAtRef.current > STALL_MS;
      const reach = stalled ? RESCUE_REACH : undefined;
      const { cursor, score, matched } = alignCursor(
        modelRef.current.words,
        cursorRef.current,
        recent,
        0.6,
        reach,
      );
      console.log(`${LOG} match score:`, score.toFixed(2), "→ cursor", cursor);

      if (matched && cursor > cursorRef.current) {
        const jump = cursor - cursorRef.current;
        const bigJump = jump > MAX_JUMP;
        if (bigJump && !stalled) {
          // Salto grande precisa de confirmação em duas leituras seguidas.
          const pending = pendingJumpRef.current;
          if (!pending || Math.abs(pending - cursor) > 2) {
            pendingJumpRef.current = cursor;
            setListenState((s) => (s === "following" ? s : "hearing"));
            bumpSilence();
            return;
          }
        }
        pendingJumpRef.current = null;
        lastMatchAtRef.current = performance.now();
        // O interino move de forma provisória; o final consolida a posição.
        if (sawFinal) committedCursorRef.current = cursor;
        console.log(`${LOG} advancing:`, cursorRef.current, "→", cursor, sawFinal ? "(final)" : "(interim)");
        applyCursor(cursor);
        setListenState("following");
      } else {
        // Interino que "desfez" a fala não deve puxar o texto para trás abaixo
        // do que já foi confirmado por um resultado final.
        if (cursorRef.current < committedCursorRef.current) {
          applyCursor(committedCursorRef.current);
        }
        setListenState((s) => (s === "following" ? s : "hearing"));
      }
      bumpSilence();
    };


    safeStart();

    return () => {
      manualStopRef.current = true;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.onstart = null;
      try {
        rec.abort?.();
        rec.stop();
      } catch {
        /* noop */
      }
      recRef.current = null;
      setListenState("idle");
    };
  }, [enabled, applyCursor]);

  return { segmentIndex, wordCursor, listenState, errorCode, stepSegment, resetFollow };
}
