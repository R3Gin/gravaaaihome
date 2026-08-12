// Monta o código-fonte do AudioWorkletProcessor do RNNoise.
// O módulo WASM do RNNoise (@jitsi/rnnoise-wasm, variante "sync" com o binário
// embutido em base64) é injetado como texto dentro do worklet, porque o
// AudioWorkletGlobalScope não tem fetch/importScripts para carregar o .wasm.
import rnnoiseSyncSource from "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js?raw";

const PROCESSOR = /* js */ `
const RN_FRAME = 480;

class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = true;
    this.ready = false;
    this.queue = [];
    this.queueOffset = 0;
    this.inBuf = new Float32Array(RN_FRAME);
    this.inLen = 0;

    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "enabled") this.enabled = !!e.data.value;
    };

    if (sampleRate !== 48000) {
      this.port.postMessage({ type: "unsupported", reason: "sampleRate:" + sampleRate });
      return;
    }
    try {
      const mod = createRNNWasmModuleSync();
      this.mod = mod;
      this.state = mod._rnnoise_create(0);
      this.ptr = mod._malloc(RN_FRAME * 4);
      this.ready = true;
      this.port.postMessage({ type: "ready" });
    } catch (err) {
      this.port.postMessage({ type: "error", message: String(err) });
    }
  }

  processFrame() {
    const mod = this.mod;
    const heap = mod.HEAPF32;
    const base = this.ptr >> 2;
    for (let i = 0; i < RN_FRAME; i++) heap[base + i] = this.inBuf[i] * 32768;
    mod._rnnoise_process_frame(this.state, this.ptr, this.ptr);
    const out = new Float32Array(RN_FRAME);
    for (let i = 0; i < RN_FRAME; i++) out[i] = heap[base + i] / 32768;
    this.queue.push(out);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const outCh = output[0];
    const input = inputs[0];
    const ch = input && input[0] ? input[0] : null;

    if (!this.ready || !this.enabled || !ch) {
      if (ch) outCh.set(ch);
      else outCh.fill(0);
      for (let c = 1; c < output.length; c++) output[c].set(outCh);
      return true;
    }

    for (let i = 0; i < ch.length; i++) {
      this.inBuf[this.inLen++] = ch[i];
      if (this.inLen === RN_FRAME) {
        this.processFrame();
        this.inLen = 0;
      }
    }

    for (let i = 0; i < outCh.length; i++) {
      const head = this.queue[0];
      if (!head) {
        outCh[i] = 0;
        continue;
      }
      outCh[i] = head[this.queueOffset++];
      if (this.queueOffset >= head.length) {
        this.queue.shift();
        this.queueOffset = 0;
      }
    }
    for (let c = 1; c < output.length; c++) output[c].set(outCh);
    return true;
  }
}

registerProcessor("rnnoise-processor", RnnoiseProcessor);
`;

/** Fonte completa (wasm inline + processor), pronta para virar Blob URL. */
export function buildRnnoiseWorkletSource(): string {
  const sanitized = rnnoiseSyncSource
    .replace(/export\s+default\s+createRNNWasmModuleSync;?/g, "")
    .replace(/import\.meta\.url/g, '""');
  return `${sanitized}\n${PROCESSOR}`;
}
