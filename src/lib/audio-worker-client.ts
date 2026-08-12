/**
 * Cliente do worker de análise de áudio. Mantém um único worker vivo e
 * devolve promessas por requisição. Se o worker não puder ser criado,
 * o chamador cai no cálculo local (fallback).
 */
import type { AnalysisRequest, AnalysisResponse } from "@/lib/audio-analysis.worker";

let worker: Worker | null = null;
let failed = false;
let seq = 0;
const pending = new Map<number, (res: AnalysisResponse) => void>();

function ensure(): Worker | null {
  if (failed) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./audio-analysis.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<AnalysisResponse>) => {
      const resolve = pending.get(e.data.id);
      if (resolve) {
        pending.delete(e.data.id);
        resolve(e.data);
      }
    };
    worker.onerror = () => {
      failed = true;
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    failed = true;
    return null;
  }
}

function run<T extends AnalysisResponse>(
  payload: Omit<Extract<AnalysisRequest, { type: T["type"] }>, "id">,
): Promise<T | null> {
  const w = ensure();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise<T | null>((resolve) => {
    pending.set(id, (res) => resolve(res as T));
    const msg = { ...payload, id } as AnalysisRequest;
    // a cópia do canal é transferida (zero-copy) para não bloquear a UI
    w.postMessage(msg, [msg.channel.buffer]);
  });
}

export function silencesInWorker(
  channel: Float32Array,
  sampleRate: number,
  sensitivity: number,
  minDuration: number,
) {
  return run<Extract<AnalysisResponse, { type: "silences" }>>({
    type: "silences",
    channel,
    sampleRate,
    sensitivity,
    minDuration,
  });
}

export function peaksInWorker(
  channel: Float32Array,
  sampleRate: number,
  bucketsPerSecond: number,
) {
  return run<Extract<AnalysisResponse, { type: "peaks" }>>({
    type: "peaks",
    channel,
    sampleRate,
    bucketsPerSecond,
  });
}
