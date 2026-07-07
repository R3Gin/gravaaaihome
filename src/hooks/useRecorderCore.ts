// Núcleo de gravação compartilhado: pega um MediaStream pronto, escolhe o melhor
// MIME (preferindo MP4 nativo), gerencia o MediaRecorder, timer, blob final e
// conversão para MP4 via ffmpeg.wasm quando o navegador só entrega WebM.
// É usado tanto pela gravação principal (tela) quanto pela nova página de
// Apresentação do Google + Câmera (composição em canvas).

import { useCallback, useEffect, useRef, useState } from "react";
import { convertWebmToMp4, fixWebmSeekable, remuxMp4FastStart } from "@/lib/ffmpeg-convert";

export type RecorderStatus =
  | "idle"
  | "recording"
  | "converting"
  | "ready";

export interface RecorderReady {
  blob: Blob;
  url: string;
  ext: "mp4" | "webm";
  mime: string;
}

export interface UseRecorderCoreOptions {
  onReady?: (r: RecorderReady) => void;
  onError?: (msg: string) => void;
  fileNameBase?: string;
}

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function useRecorderCore(opts: UseRecorderCoreOptions = {}) {
  const { onReady, onError, fileNameBase = "gravaai" } = opts;

  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadExt, setDownloadExt] = useState<"mp4" | "webm">("mp4");
  const [convertProgress, setConvertProgress] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const downloadBlobRef = useRef<Blob | null>(null);
  const rawRecordingSizeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const downloadUrlRef = useRef<string | null>(null);
  const recordStartedAtRef = useRef<number>(0);

  useEffect(() => {
    downloadUrlRef.current = downloadUrl;
  }, [downloadUrl]);

  const reportError = useCallback(
    (msg: string) => {
      setError(msg);
      onError?.(msg);
    },
    [onError],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    chunksRef.current = [];
    downloadBlobRef.current = null;
    rawRecordingSizeRef.current = 0;
    recorderRef.current = null;
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = null;
    }
    setDownloadUrl(null);
    setDownloadExt("mp4");
    setElapsed(0);
    setConvertProgress(0);
    setError(null);
    setStatus("idle");
  }, [clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
      try {
        recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      } catch {
        /* noop */
      }
    };
  }, [clearTimer]);

  const startRecording = useCallback(
    (stream: MediaStream) => {
      if (!stream || stream.getVideoTracks().length === 0) {
        reportError("Nenhuma faixa de vídeo ativa para gravar.");
        return;
      }
      chunksRef.current = [];
      downloadBlobRef.current = null;
      rawRecordingSizeRef.current = 0;
      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current);
        downloadUrlRef.current = null;
        setDownloadUrl(null);
      }
      setElapsed(0);
      setError(null);

      let rec: MediaRecorder | null = null;
      let chosenMime = "";
      for (const candidate of MIME_CANDIDATES) {
        if (!MediaRecorder.isTypeSupported(candidate)) continue;
        try {
          rec = new MediaRecorder(stream, { mimeType: candidate });
          chosenMime = candidate;
          break;
        } catch (err) {
          console.warn("[recorder-core] rejeitado", candidate, err);
        }
      }
      if (!rec) {
        try {
          rec = new MediaRecorder(stream);
          chosenMime = rec.mimeType || "video/webm";
        } catch (err) {
          console.error("[recorder-core] MediaRecorder falhou:", err);
          reportError(
            "Este navegador não conseguiu iniciar a gravação. Tente no Chrome desktop mais recente.",
          );
          return;
        }
      }
      const isNativeMp4 = chosenMime.startsWith("video/mp4");
      console.log("[recorder-core] gravando com", chosenMime);

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onerror = (e) => {
        console.error("[recorder-core] onerror", e);
        reportError("A gravação falhou durante a captura.");
        clearTimer();
        setStatus("idle");
      };
      rec.onstart = () => {
        setStatus("recording");
        const started = Date.now();
        recordStartedAtRef.current = started;
        clearTimer();
        timerRef.current = setInterval(
          () => setElapsed((Date.now() - started) / 1000),
          250,
        );
      };
      rec.onstop = async () => {
        clearTimer();
        const recordedType = isNativeMp4 ? "video/mp4" : "video/webm";
        if (chunksRef.current.length === 0) {
          reportError("A gravação terminou sem dados. Tente novamente.");
          setStatus("idle");
          return;
        }
        let blob = new Blob(chunksRef.current, { type: recordedType });
        rawRecordingSizeRef.current = blob.size;
        chunksRef.current = [];
        if (!isNativeMp4) {
          const durMs = Date.now() - (recordStartedAtRef.current || Date.now());
          blob = await fixWebmSeekable(blob, durMs);
        }
        const finalize = (mp4Blob: Blob, ext: "mp4" | "webm", mime: string) => {
          downloadBlobRef.current = mp4Blob;
          const url = URL.createObjectURL(mp4Blob);
          downloadUrlRef.current = url;
          setDownloadUrl(url);
          setDownloadExt(ext);
          setStatus("ready");
          onReady?.({ blob: mp4Blob, url, ext, mime });
        };
        setStatus("converting");
        setConvertProgress(0);
        try {
          const mp4 = isNativeMp4
            ? await remuxMp4FastStart(blob, (r) => setConvertProgress(r))
            : await convertWebmToMp4(blob, (r) => setConvertProgress(r));
          finalize(mp4, "mp4", "video/mp4");
        } catch (err) {
          console.error("[recorder-core] processamento MP4 falhou:", err);
          reportError(
            "Não foi possível gerar um MP4 válido para download. Tente gravar novamente.",
          );
          downloadBlobRef.current = null;
          setDownloadUrl(null);
          setStatus("idle");
        }
      };
      recorderRef.current = rec;
      try {
        rec.start(1000);
      } catch (err) {
        console.error("[recorder-core] start falhou:", err);
        reportError("Não foi possível iniciar a gravação.");
      }
    },
    [clearTimer, onReady, reportError],
  );

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.requestData();
      } catch {
        /* noop */
      }
      rec.stop();
    }
  }, []);

  const download = useCallback(() => {
    const finalBlob = downloadBlobRef.current;
    if (!finalBlob) return;
    console.log(`[recorder-core] Blob final para download: ${finalBlob.size} bytes (MediaRecorder bruto: ${rawRecordingSizeRef.current} bytes)`);
    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileNameBase}.${downloadExt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [downloadExt, fileNameBase]);

  return {
    status,
    elapsed,
    error,
    downloadUrl,
    downloadExt,
    convertProgress,
    startRecording,
    stopRecording,
    download,
    reset,
    setError: reportError,
  };
}