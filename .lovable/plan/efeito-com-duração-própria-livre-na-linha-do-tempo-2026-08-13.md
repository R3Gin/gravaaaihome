# Efeito com duração própria, livre na linha do tempo

Hoje um efeito do modo Simples nasce preso dentro de um único clipe: ele é gravado como keyframes daquele clipe e sua duração vem do preset (velocidade/duração), sem barra para arrastar. Se o clipe for curto, o efeito acaba junto com ele.

## O que muda

1. Cada efeito aplicado passa a ter **início e fim em tempo da linha do tempo**, não em tempo local do clipe.
2. O efeito aparece como uma **barra na faixa "Efeitos"**, com o nome do preset:
   - arrastar a barra move o efeito no tempo;
   - arrastar as bordas estica ou encurta a duração;
   - o ímã e o zoom da timeline valem também para essa barra.
3. Um efeito pode **atravessar vários clipes**. Ao aplicar/mover/redimensionar, os keyframes são regerados em todos os clipes que a barra cobrir, cada um recebendo a fatia correspondente da curva — a animação continua contínua ao cruzar um corte.
4. A duração inicial continua vindo do preset (a partir da agulha), mas deixa de ser um teto: pode ser esticada até o fim da linha do tempo.
5. Efeitos de saída continuam nascendo colados no fim do clipe atual, mas também podem ser movidos/esticados depois.
6. Selecionar a barra abre os controles daquele efeito (velocidade, intensidade, zoom, ponto do zoom) no painel Simples; Delete remove o efeito e apenas os keyframes gerados por ele.
7. Exportação: nada de novo no caminho de exportação — continuam sendo keyframes comuns por clipe, então preview e MP4 seguem iguais.

## Detalhes técnicos

- `AppliedPreset` (em `src/state/editor-store.ts`) troca `anchor: number` (local ao clipe) por `start: number` e `end: number` em tempo global; migração simples na leitura (`start = clip.startTime + anchor`).
- Os efeitos deixam de ficar apenas dentro do clipe: passa a existir `effects: AppliedPreset[]` no estado do projeto, com `clipIds` derivados por interseção; cada clipe continua guardando os keyframes gerados marcados por `origin` (id da instância), o que mantém remoção e "editado" funcionando.
- Nova função em `src/lib/effect-presets.ts`: `buildRange(clip, params, globalStart, globalEnd)` — normaliza o progresso 0..1 pela janela global e converte para tempo local do clipe, para que a mesma curva seja fatiada entre clipes vizinhos.
- Novas ações no store: `moveEffect(id, start)`, `resizeEffect(id, start, end)`, `rebuildEffect(id)` (chamada também quando clipes se movem/cortam), reaproveitando `applySnap`/`freeStart` de `src/lib/snap.ts` para o ímã.
- `src/components/editor/Timeline.tsx`: a faixa "Efeitos" passa a renderizar as barras de efeito (arraste + handles de trim, mesmo padrão dos clipes), aparecendo só quando existe pelo menos um efeito.
- `src/components/editor/panels/EffectsSimplePanel.tsx`: os chips mostram o intervalo (ex.: `00:07 – 00:12`) em vez de só a âncora, e a seleção da barra na timeline sincroniza com o chip aberto.
