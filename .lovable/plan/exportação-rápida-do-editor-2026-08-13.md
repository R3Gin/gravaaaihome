# Exportação rápida do Editor

## O problema (verificado no código)

Hoje toda exportação passa por `exportTimeline` em `src/lib/ffmpeg-convert.ts`, que:

- carrega o **ffmpeg-core single-thread** de CDN (`.../dist/esm`, sem multithread) — ou seja, 1 núcleo só;
- reencoda **tudo** com `libx264 -preset veryfast -crf 23`, mesmo quando o vídeo não mudou;
- monta um `filter_complex` com filtros muito caros por software: `geq` (usado para opacidade, é o mais lento de todos), `rotate`, `boxblur`, `crop+scale` duplicado por clipe, `xfade`;
- imprime **cada linha de log do ffmpeg no console** (`console.log("[ffmpeg]", message)`), o que sozinho engasga a aba em exportações longas.

Combinando isso, é normal um vídeo de poucos minutos levar muitos minutos. Não é bug pontual: é o caminho de exportação inteiro.

## O que vou fazer

### 1. Novo motor de exportação com WebCodecs (padrão quando disponível)

Renderizar a timeline quadro a quadro no canvas (reaproveitando `buildFrame`/`drawFrame` de `src/lib/preview-compose.ts`, o mesmo que já desenha o preview) e codificar com `VideoEncoder` acelerado por hardware + `AudioEncoder`, empacotando em MP4 (mux via `mp4-muxer`). Ganho esperado: de vários minutos para segundos/poucos minutos, tipicamente 5–20x mais rápido, porque usa a GPU/encoder do sistema em vez de x264 em WebAssembly de um núcleo só.

Efeitos (zoom, pan, rotação, opacidade, brilho/contraste/saturação, textos, blur, anotações, transições) passam a ser desenhados no canvas — exatamente o que o usuário vê no preview —, então o MP4 fica igual à pré-visualização, sem os filtros caros do ffmpeg.

### 2. Caminho ultrarrápido (cópia sem reencode)

Se a timeline for um único clipe sem cortes, sem efeitos, sem texto e sem mudança de proporção, exportar com `-c copy` (remux puro, praticamente instantâneo) em vez de reencodar.

### 3. Fallback ffmpeg otimizado

Se o navegador não suportar WebCodecs/`VideoEncoder`, continua no ffmpeg, mas com:

- logs do ffmpeg silenciados por padrão (só ligados em modo debug);
- `-preset ultrafast -crf 26 -tune zerolatency` para exportação padrão;
- opacidade sem `geq` (usar `format=yuva420p,colorchannelmixer=aa=...` ou `fade`), que é a maior fonte de lentidão;
- filtros só aplicados quando o clipe realmente usa aquele efeito.

### 4. Feedback real de progresso

Barra de progresso com percentual real por quadro codificado, tempo restante estimado, e opção de continuar usando o editor durante a exportação (o encode roda fora da thread de UI).

### 5. Escolha de qualidade

Um seletor simples no diálogo de exportação: **Rápida** (720p, bitrate menor), **Padrão** (1080p) e **Alta** (1080p bitrate alto). Padrão inicial: Rápida para gravações de tela, que é onde a demora mais incomoda.

## Detalhes técnicos

- Novo `src/lib/export-webcodecs.ts`: loop de render por frame com `HTMLVideoElement` + `requestVideoFrameCallback` (ou `WebCodecs VideoDecoder` para seek preciso), `VideoEncoder` (`avc1.42E01F`), `AudioEncoder` (AAC) e `mp4-muxer` para o container.
- `src/lib/export-project.ts` vira o roteador: fast-copy → WebCodecs → ffmpeg (fallback), mantendo a mesma assinatura para `VideoEditor.tsx` não mudar.
- `src/lib/ffmpeg-convert.ts`: logs condicionais, presets mais rápidos, remoção do `geq`.
- Dependência nova: `mp4-muxer` (leve, sem WASM).
- Sem mudanças de backend e sem mudar a identidade visual.

## Verificação

Exportar o mesmo projeto pelos dois caminhos e comparar tempo, duração e sincronia de áudio; conferir que zoom, opacidade, texto e transições aparecem no MP4 final.
