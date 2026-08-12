# Efeitos ancorados na agulha (playhead)

## Problema confirmado

No modo Simples, todos os presets de efeito são gerados com tempos fixos a partir do começo do clipe: em `src/lib/effect-presets.ts` os keyframes de Zoom e Ênfase começam sempre em `k(0, ...)`, e os de Saída sempre no fim do clipe. Por isso, mesmo com o vídeo rodando na posição 00:07, o zoom aparece marcado no início da faixa (como no print).

O botão de losango do modo Avançado já usa a agulha corretamente (`addKeyframeAt` usa `currentTime`); só os presets ignoram.

## O que muda

1. Presets passam a receber um "ponto de ancoragem" = posição atual da agulha convertida para tempo local do clipe.
2. Comportamento por categoria:
   - **Zoom** (suave, rápido, zoom e volta): começa exatamente na agulha. "Zoom e volta" ocupa a duração escolhida a partir dali.
   - **Ênfase** (pulsar, tremer, piscar): começa na agulha e dura o ciclo definido (não mais o clipe inteiro).
   - **Entrada**: por padrão continua no início do clipe, mas se a agulha estiver dentro do clipe e além do início, ela vira o ponto de entrada.
   - **Saída**: continua ancorada no fim do clipe (é o comportamento esperado de uma saída).
3. Se a agulha estiver fora do clipe selecionado, cai no comportamento atual (início do clipe).
4. Ao reajustar os parâmetros de um efeito já aplicado (velocidade, zoom, duração), o efeito mantém a âncora original em vez de pular para o início.
5. Indicação na interface: no painel Simples, mostrar o tempo da âncora (ex.: "Aplicar em 00:07") logo acima dos botões de preset, para ficar claro onde o efeito vai cair.

## Detalhes técnicos

- `EffectPresetDef.build(clip, params, anchor)` ganha o terceiro argumento `anchor` (segundos, local ao clipe). Helper `k()` passa a somar a âncora nas categorias `zoom`/`in`/`emphasis`.
- `AppliedPreset` (em `src/state/editor-store.ts`) passa a guardar `anchor: number`, gravado em `applyEffectPreset` a partir de `currentTime - clip.startTime` (clamp em 0..duration) e reutilizado por `updateEffectPresetParams`.
- Clamps para não estourar o fim do clipe: se `anchor + duração do efeito > clip.duration`, a duração é reduzida (mínimo já usado hoje, 0.2s).
- `EffectsSimplePanel.tsx` lê `currentTime` do store para exibir o rótulo da âncora.
- Nada muda na exportação: os presets continuam gerando keyframes normais, então preview e MP4 seguem o mesmo caminho já validado.
