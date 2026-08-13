# Silêncio sempre com base no vídeo atual da timeline

## O que está acontecendo

O detector de silêncio analisa sempre o arquivo original enviado (`sourceBlob`), e usa os tempos desse arquivo como se fossem tempos da timeline. Enquanto você não corta nada, os dois coincidem. Depois do primeiro corte, a timeline fica mais curta e deslocada, mas a detecção continua devolvendo os tempos do vídeo original — por isso ele "lembra" da versão antiga e marca trechos que não batem mais com o que está na tela.

Confirmado no código: `SilencePanel` chama `detectSilences(sourceBlob, ...)` e joga o resultado direto em `silences`, que a timeline desenha em coordenadas de timeline e que `cutRanges` consome como tempo de timeline.

## Correção

1. **Remapear para o tempo atual da timeline.** Depois de detectar no áudio original, converter cada trecho silencioso usando o mapeamento dos clipes de vídeo/áudio que ainda existem (`sourceInStart`/`sourceInEnd` → `startTime`, respeitando velocidade). Trechos que já foram removidos somem da lista; trechos parcialmente cortados são recortados; um silêncio que atravessa dois clipes vira dois marcadores.

2. **Recalcular toda vez que o painel abre.** Ao montar o painel, limpar o resultado anterior e rodar uma nova detecção, sempre com o estado atual dos clipes — nada de reaproveitar a leitura anterior.

3. **Reagir a mudanças na timeline.** Se você cortar, mover ou apagar clipes com o painel aberto, os marcadores são recalculados (remapeamento, sem redecodificar o áudio) em vez de ficarem defasados.

4. **Contador coerente.** A contagem de trechos e o total de segundos a remover passam a refletir só o que está de fato na timeline agora.

## Detalhes técnicos

- Nova função em `src/lib/audio-tools.ts` (ou módulo auxiliar): `mapSourceRangesToTimeline(ranges, clips)`, intersectando cada intervalo com a janela de origem de cada clipe de vídeo/áudio e convertendo para tempo de timeline `startTime + (t - sourceInStart) / speed`.
- `src/components/editor/panels/SilencePanel.tsx`: guarda os segmentos em tempo de origem num ref, e deriva `silences` (tempo de timeline) sempre que a detecção, os sliders ou `tracks` mudarem; limpa `silences` na montagem.
- O áudio decodificado continua vindo do `sourceBlob` — a mudança é só de mapeamento; `cutRanges` segue recebendo tempos de timeline, como já espera.
- Sem mudanças visuais no painel nem no restante do editor.
