// Worker de pós-produção: aplica RNNoise em um buffer inteiro (offline),
// sem travar a UI, reportando progresso.
import createRNNWasmModuleSync from "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js";

const FRAME = 480;

type Req = { samples: Float32Array; sampleRate: number };

self.onmessage = async (e: MessageEvent<Req>) => {
  const { samples, sampleRate } = e.data;
  try {
    if (sampleRate !== 48000) throw new Error("RNNoise exige 48 kHz");
    const mod = (
      createRNNWasmModuleSync as unknown as () => {
        _rnnoise_create: (n: number) => number;
        _rnnoise_destroy: (s: number) => void;
        _rnnoise_process_frame: (s: number, o: number, i: number) => number;
        _malloc: (n: number) => number;
        _free: (p: number) => void;
        HEAPF32: Float32Array;
      }
    )();
    const state = mod._rnnoise_create(0);
    const ptr = mod._malloc(FRAME * 4);
    const base = ptr >> 2;
    const out = new Float32Array(samples.length);
    const totalFrames = Math.ceil(samples.length / FRAME);
    let lastReport = 0;

    for (let f = 0; f < totalFrames; f++) {
      const off = f * FRAME;
      const heap = mod.HEAPF32;
      for (let i = 0; i < FRAME; i++) {
        const v = off + i < samples.length ? samples[off + i]! : 0;
        heap[base + i] = v * 32768;
      }
      mod._rnnoise_process_frame(state, ptr, ptr);
      for (let i = 0; i < FRAME && off + i < out.length; i++) {
        out[off + i] = mod.HEAPF32[base + i]! / 32768;
      }
      const p = (f + 1) / totalFrames;
      if (p - lastReport >= 0.02) {
        lastReport = p;
        self.postMessage({ type: "progress", value: p });
      }
    }

    mod._free(ptr);
    mod._rnnoise_destroy(state);
    self.postMessage({ type: "done", samples: out }, [out.buffer] as never);
  } catch (err) {
    self.postMessage({ type: "error", message: String(err) });
  }
};
