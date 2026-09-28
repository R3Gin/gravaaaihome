import { create } from "zustand";
import { speechPlaceholders, transcribe, transcribeSamples } from "@/lib/captions";
import { composeTimelineAudio, type AudioClipRef } from "@/lib/timeline-audio";
import { useEditor } from "@/state/editor-store";

/**
 * Geração de legendas fora do painel: o painel pode ser fechado (troca de aba
 * do editor) ou a aba do navegador ir para segundo plano sem perder o trabalho.
 * Ao voltar, o painel lê o andamento daqui.
 */
interface CaptionJobState {
  busy: boolean;
  stage: string;
  /** progresso do download do modelo (0..1) */
  download: number;
  /** progresso da transcrição (0..1) */
  progress: number;
  error: string | null;
  /** aumenta a cada geração concluída (o painel usa para abrir a lista) */
  finished: number;
}

export const useCaptionJob = create<CaptionJobState>(() => ({
  busy: false,
  stage: "",
  download: 0,
  progress: 0,
  error: null,
  finished: 0,
}));

const STAGE_LABEL = {
  audio: "Montando o áudio já cortado…",
  model: "Carregando modelo (só na primeira vez)…",
  transcribe: "Transcrevendo…",
  finalize: "Transcrevendo…",
} as const;

export function clearCaptionJobError() {
  useCaptionJob.setState({ error: null });
}

/** gera as legendas do áudio final da timeline; ignorado se já houver uma em andamento */
export async function runCaptionJob(lang: string) {
  const sourceBlob = useEditor.getState().sourceBlob;
  if (!sourceBlob || useCaptionJob.getState().busy) return;
  const set = useCaptionJob.setState;
  set({ busy: true, error: null, download: 0, progress: 0, stage: STAGE_LABEL.audio });
  try {
    // sempre transcreve o áudio FINAL da timeline (com os cortes aplicados)
    const clips = useEditor.getState().tracks.flatMap((t) => t.clips) as AudioClipRef[];
    const composed = await composeTimelineAudio(clips, sourceBlob);
    const sig = useEditor.getState().audioSignature();
    console.info(
      composed
        ? `[legendas] áudio composto da timeline: ${composed.duration.toFixed(2)}s · ${composed.covered.length} trecho(s)`
        : "[legendas] não consegui compor o áudio da timeline — usando o arquivo original",
    );
    const events = {
      onStage: (s: keyof typeof STAGE_LABEL) => set({ stage: STAGE_LABEL[s] }),
      onDownload: (download: number) => set({ download }),
      onProgress: (progress: number) => set({ progress }),
    };
    const res = composed
      ? await transcribeSamples(composed.audio, lang, events)
      : await transcribe(sourceBlob, lang, events);
    useEditor.getState().addCaptionClips(res.segments, res.words, { timeline: !!composed, sig });
    set((s) => ({ finished: s.finished + 1 }));
  } catch (err) {
    set({ error: err instanceof Error ? err.message : "Não consegui gerar as legendas." });
  } finally {
    set({ busy: false, stage: "" });
  }
}

/** alternativa sem modelo: blocos de fala vazios para preencher à mão */
export async function runSpeechBlocksJob() {
  const sourceBlob = useEditor.getState().sourceBlob;
  if (!sourceBlob || useCaptionJob.getState().busy) return;
  const set = useCaptionJob.setState;
  set({ busy: true, error: null, download: 0, progress: 0, stage: "Analisando o áudio…" });
  try {
    useEditor.getState().addCaptionClips(await speechPlaceholders(sourceBlob));
    set((s) => ({ finished: s.finished + 1 }));
  } catch (err) {
    set({ error: err instanceof Error ? err.message : "Não consegui analisar o áudio desse vídeo." });
  } finally {
    set({ busy: false, stage: "" });
  }
}
