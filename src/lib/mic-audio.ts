// Constraints nativos de tratamento de áudio do navegador para captura de microfone.
export const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

/** Captura microfone com os tratamentos nativos ligados e loga o suporte real. */
export async function getProcessedMicStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: MIC_AUDIO_CONSTRAINTS,
    video: false,
  });
  logMicSettings(stream);
  return stream;
}

export function logMicSettings(stream: MediaStream) {
  const track = stream.getAudioTracks()[0];
  if (!track) return;
  try {
    const s = track.getSettings();
    console.info("[mic] settings aplicados:", {
      noiseSuppression: s.noiseSuppression,
      echoCancellation: s.echoCancellation,
      autoGainControl: s.autoGainControl,
    });
  } catch {
    /* noop */
  }
}
