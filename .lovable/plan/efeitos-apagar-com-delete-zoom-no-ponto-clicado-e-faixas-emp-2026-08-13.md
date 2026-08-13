# Efeitos: apagar com Delete, zoom no ponto clicado e faixas empilhadas

Três ajustes na parte de efeitos do editor, mantendo o tamanho e o visual das barras como estão hoje.

## 1. Delete apaga o efeito selecionado

Hoje o Delete só apaga keyframes ou clipes; a barra de efeito só some pelo "×".

- Com uma barra de efeito selecionada (clicada na faixa "Efeitos" ou pelo chip no painel Simples), Delete/Backspace remove aquele efeito e apenas os keyframes que ele gerou.
- Ordem de prioridade do Delete: keyframes selecionados > efeito selecionado > clipes selecionados.
- Clicar no vazio ou Esc limpa a seleção do efeito.

## 2. Zoom vai para o ponto que você marcar na tela

- Todos os presets de zoom passam a pedir o ponto: ao clicar no cartão, o preview entra em modo mira e o clique define onde o zoom acontece.
- Depois de aplicado, dá para **recolocar o ponto**: com o efeito selecionado, um botão "Marcar ponto no vídeo" no painel arma a mira de novo e o próximo clique no preview atualiza o centro do zoom do efeito já existente (sem criar outro).
- O painel do efeito mostra o ponto atual (ex.: `x 72% · y 30%`), e a intensidade/duração continuam ajustáveis ali — o ponto define onde, os controles definem quanto e até quando.
- Um marcador discreto aparece no preview enquanto o efeito de zoom está selecionado, para você ver onde o foco está.

## 3. Vários efeitos livres, em faixas empilhadas

- A faixa "Efeitos" deixa de ser uma linha só: efeitos que se sobrepõem no tempo ganham linhas próprias (como as faixas de vídeo/áudio), então dá para marcar quantos quiser, um por cima do outro, sem que as barras se escondam.
- A altura da área de efeitos cresce conforme o número de linhas necessárias, e some quando não há efeitos.
- Arrastar/esticar continua igual; ao mover uma barra para um trecho livre, ela volta para a primeira linha disponível.

## Detalhes técnicos

- `src/components/VideoEditor.tsx`: no handler de teclado, tratar `selectedEffectId` no bloco Delete/Backspace antes de `removeSelected()`.
- `src/lib/effect-presets.ts`: `needsPoint: true` em todos os presets da categoria `zoom`; expor o `point` nos controles.
- `src/state/editor-store.ts`: nova ação `setEffectPoint(effectId, point)` (reaproveita `updateEffectPresetParams` + `applyEffectsToTracks`) e `pendingEffectPreset` ganha variante `{ mode: "repoint", effectId }`.
- `src/components/editor/Preview.tsx`: no `onPointerDown`, se o pending for `repoint`, chamar `setEffectPoint` em vez de `applyEffectPreset`; desenhar o marcador do ponto quando o efeito de zoom estiver selecionado.
- `src/components/editor/Timeline.tsx`: calcular linhas por interseção (algoritmo simples de alocação por camada) e posicionar cada `EffectBar` com `top = row * FX_H`; altura total da faixa = `rows * FX_H`.
- `src/components/editor/panels/EffectsSimplePanel.tsx`: no bloco de controles do efeito aberto, botão "Marcar ponto no vídeo" + leitura do ponto atual.
