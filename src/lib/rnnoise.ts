// Carregamento sob demanda do RNNoise (WASM) para uso em tempo real via
// AudioWorklet, com fallback para um filtro simples (passa-alta + compressor).
import { buildRnnoiseWorkletSource } from "./rnnoise-worklet-source";

let workletUrl: string | null = null;
const registered = new WeakSet<BaseAudioContext>();

async function ensureWorklet(ctx: BaseAudioContext) {
  if (!ctx.audioWorklet) throw new Error("AudioWorklet indisponível");
  if (registered.has(ctx)) return;
  if (!workletUrl) {
    const blob = new Blob([buildRnnoiseWorkletSource()], { type: "text/javascript" });
    workletUrl = URL.createObjectURL(blob);
  }
  await ctx.audioWorklet.addModule(workletUrl);
  registered.add(ctx);
}

/**
 * Cria o nó RNNoise. Retorna null se o navegador/contexto não suportar
 * (ex.: sample rate diferente de 48 kHz ou falha ao carregar o WASM).
 */
export async function createRnnoiseNode(
  ctx: AudioContext | OfflineAudioContext,
): Promise<AudioWorkletNode | null> {
  try {
    await ensureWorklet(ctx);
    const node = new AudioWorkletNode(ctx, "rnnoise-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      node.port.onmessage = (e: MessageEvent) => {
        const type = (e.data as { type?: string })?.type;
        if (type === "ready") {
          clearTimeout(timer);
          resolve(true);
        } else if (type === "error" || type === "unsupported") {
          clearTimeout(timer);
          console.warn("[rnnoise] indisponível:", e.data);
          resolve(false);
        }
      };
    });
    if (!ok) {
      node.disconnect();
      return null;
    }
    return node;
  } catch (err) {
    console.warn("[rnnoise] falha ao carregar:", err);
    return null;
  }
}

/** Filtro simples usado como fallback: passa-alta + gate/compressor + makeup. */
export function createFallbackDenoiseChain(ctx: BaseAudioContext): {
  input: AudioNode;
  output: AudioNode;
} {
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 90;
  const gate = ctx.createDynamicsCompressor();
  gate.threshold.value = -45;
  gate.knee.value = 6;
  gate.ratio.value = 12;
  gate.attack.value = 0.003;
  gate.release.value = 0.15;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.3;
  hp.connect(gate).connect(makeup);
  return { input: hp, output: makeup };
}

/**
 * Conecta uma fonte de áudio ao pipeline de redução de ruído.
 * Retorna o nó de saída já processado e qual modo foi usado.
 */
export async function connectDenoise(
  ctx: AudioContext,
  source: AudioNode,
): Promise<{ output: AudioNode; mode: "rnnoise" | "fallback" }> {
  const rnn = await createRnnoiseNode(ctx);
  if (rnn) {
    source.connect(rnn);
    return { output: rnn, mode: "rnnoise" };
  }
  const chain = createFallbackDenoiseChain(ctx);
  source.connect(chain.input);
  return { output: chain.output, mode: "fallback" };
}

/**
 * Recebe uma stream de microfone e devolve uma stream já tratada pelo RNNoise
 * (ou pelo filtro simples, se o WASM não puder ser carregado).
 */
export async function denoiseMicStream(mic: MediaStream): Promise<{
  stream: MediaStream;
  ctx: AudioContext;
  mode: "rnnoise" | "fallback";
}> {
  const Ctor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  let ctx: AudioContext;
  try {
    ctx = new Ctor({ sampleRate: 48000 });
  } catch {
    ctx = new Ctor();
  }
  const src = ctx.createMediaStreamSource(mic);
  const dest = ctx.createMediaStreamDestination();
  const { output, mode } = await connectDenoise(ctx, src);
  output.connect(dest);
  console.info("[rnnoise] microfone ao vivo:", mode);
  return { stream: dest.stream, ctx, mode };
}
