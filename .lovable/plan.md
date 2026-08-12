# Efeitos em dois modos: Simples e Avançado

O painel de propriedades do clipe passa a abrir em **Simples** (presets de um clique) e esconde a edição manual de keyframes atrás da aba **Avançado**. Nada do que já funciona na interface de keyframes é alterado — apenas passa a ficar dentro da aba Avançado.

## 1. Seletor no topo do painel

- Duas abas: "Simples" (padrão) / "Avançado".
- Simples: galeria de presets + chips dos efeitos aplicados.
- Avançado: exatamente a UI atual (KeyframeEditor + Propriedades animáveis + controles do tipo de clipe).
- A escolha fica lembrada por sessão (ao trocar de clipe volta a Simples por padrão na primeira abertura).

## 2. Biblioteca de presets (modo Simples)

Cada preset é um cartão clicável, agrupado por categoria:

**Zoom** (só para clipes de vídeo)
- Zoom suave — entra devagar e permanece.
- Zoom rápido — mesma coisa, entrada curta.
- Zoom e volta — entra, segura e volta ao normal; slider de duração 1s–5s.
- Fluxo: clicar no cartão ativa o modo "escolher ponto"; o preview mostra cursor de mira e uma faixa "Clique no ponto do vídeo para dar zoom"; o clique no preview gera o efeito centrado nesse ponto. Esc cancela.
- Controle extra: intensidade do zoom (1.2x / 1.5x / 2x).

**Entrada**
- Aparecer com fade, Deslizar de baixo/cima/esquerda/direita, Crescer (pop, com leve overshoot + fade).
- Controle extra: velocidade (lenta / média / rápida).

**Saída**
- As mesmas opções invertidas: sumir com fade, deslizar para fora (4 direções), encolher.
- Controle extra: velocidade.

**Ênfase**
- Pulsar (escala 1.0 → 1.05 → 1.0), Tremer (posição/rotação sutil), Piscar (opacidade 1.0 → 0.6).
- Controle extra: intensidade (sutil / média / forte).

Regras de convivência: no máximo um preset de Entrada, um de Saída, um de Ênfase e um de Zoom por clipe — aplicar outro da mesma categoria substitui o anterior.

## 3. Chips de efeitos aplicados

- Acima da galeria, lista de chips: nome do preset + "x" para remover.
- Clicar no chip reabre o controle simples daquele preset (velocidade/duração/intensidade) e reaplica na hora.
- Remover o chip apaga somente os keyframes criados por aquele preset — keyframes feitos à mão no modo Avançado continuam intactos.

## 4. Estados e limites

- Sem clipe selecionado: mensagem atual ("Selecione um clipe...").
- Clipe de texto/overlay: categorias Zoom ocultas quando não fizerem sentido; entrada/saída/ênfase disponíveis.
- Se o usuário editar manualmente um keyframe gerado por preset no modo Avançado, o chip passa a exibir "(editado)" e deixa de sobrescrever automaticamente.

## Detalhes técnicos

- Novo `src/lib/effect-presets.ts`: catálogo de presets (`id`, `label`, `category`, `params`) e funções puras `buildKeyframes(clip, params)` que devolvem um `KeyframeMap` parcial usando `newKeyframe`/`sortKeys` de `src/lib/keyframes.ts`.
- Marcação de origem: estender `Keyframe` com um campo opcional `origin?: string` (id da instância do preset) — o campo `preset?: "in" | "out"` atual continua intocado para os presets de texto. Remoção de um preset = filtrar keyframes com aquele `origin`.
- Novo campo em `Clip`: `effectPresets?: AppliedPreset[]` (`{ id, presetId, params, edited? }`) para renderizar os chips e reaplicar parâmetros.
- Novas ações em `src/state/editor-store.ts`: `applyEffectPreset`, `updateEffectPresetParams`, `removeEffectPreset`, além de `pendingZoomPreset` (estado do modo "escolher ponto no preview").
- Zoom por ponto: gera keyframes de `zoom` (escala) + `position` deslocando o centro para o ponto clicado, respeitando o caminho unificado já existente em `zoomAt` e `resolveClip`; a exportação em `src/lib/export-project.ts` continua funcionando sem mudanças por serem keyframes comuns.
- Preview: `src/components/editor/Preview.tsx` ganha o modo de captura de ponto (cursor crosshair, overlay de instrução, clique converte coordenada do canvas em coordenada normalizada 0–1) sem alterar o desenho/arrasto atual.
- Inspector: `src/components/editor/Inspector.tsx` passa a ter as abas; o conteúdo atual (`KeyframeEditor` + `AnimSection` + seções por tipo de clipe) move para a aba Avançado sem mudanças internas. Novo `src/components/editor/panels/EffectsSimplePanel.tsx` para o modo Simples.
- Ênfase (Pulsar/Tremer/Piscar) é gerada como uma sequência finita de keyframes ao longo do clipe (não loop em runtime), garantindo paridade entre preview e exportação.
