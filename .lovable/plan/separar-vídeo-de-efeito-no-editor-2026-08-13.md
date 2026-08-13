# Separar "vídeo" de "efeito" no editor

Hoje o painel da direita mistura tudo: ao clicar num clipe aparecem os presets de efeito (aba Simples), keyframes (Avançado) e as propriedades do vídeo. A proposta separa isso em dois contextos claros.

## 1. Módulo "Efeitos" (barra lateral esquerda) vira a casa dos presets

- A galeria de presets prontos (Zoom, Entrada, Saída, Ênfase) sai do painel direito e passa a viver no módulo **Efeitos**.
- O módulo também mantém o que já tem hoje: Área desfocada e Destaque (spotlight).
- Lista de efeitos aplicados no projeto (chips) fica no topo do módulo, com remover e selecionar.
- Aplicar continua ancorado na agulha e, no caso do zoom, clicando no ponto do vídeo.

## 2. Painel direito clicando no vídeo = só coisa de imagem

Ao selecionar um clipe de vídeo, o painel da direita mostra apenas:
- Velocidade
- Brilho, Contraste, Saturação (com o losango de keyframe, como já existe)
- Posição, Escala, Rotação, Opacidade, Zoom (Avançado)
- Transição do clipe (tipo, duração, direção) trazida do módulo Transições para o ponto de encontro daquele clipe

Clipes de texto e overlay mantêm exatamente os controles atuais.

As abas Simples/Avançado somem; sobra um único painel de propriedades do clipe, com a seção de keyframes/propriedades animáveis (o "Avançado" atual) embaixo.

## 3. Painel direito alternando entre clipe e efeito

O painel da direita passa a ter dois estados, conforme o que estiver selecionado:
- **Clipe selecionado** → propriedades do clipe (acima).
- **Efeito selecionado** → propriedades do efeito: nome, tempo início/fim, velocidade/intensidade/zoom/duração, ponto do zoom com o botão "Marcar ponto no vídeo".

A seleção de efeito acontece de três formas, todas alternando o painel:
- Clicar na barra do efeito na faixa **Efeitos** da timeline
- Clicar no chip do efeito no módulo Efeitos
- Clicar no marcador do efeito no preview (zoom)

Selecionar um clipe limpa a seleção de efeito e vice-versa, para nunca ficar ambíguo o que está sendo editado. O cabeçalho do painel indica claramente: "Clipe · vídeo" ou "Efeito · Zoom suave".

## 4. Efeitos na timeline

A faixa **Efeitos** continua como está (barras arrastáveis, redimensionáveis, empilhadas em linhas), agora como o lugar principal de manipulação: aplicar pelo módulo, ajustar o tempo na timeline, afinar parâmetros no painel direito.

## Detalhes técnicos

- `EffectsSimplePanel.tsx` é dividido: a galeria + chips passam a ser renderizadas dentro do drawer `panel === "effects"` em `VideoEditor.tsx`; o bloco de `Controls` + ponto do zoom migra para um novo `src/components/editor/panels/EffectInspector.tsx`.
- `Inspector.tsx`: remove o toggle `mode` (simple/advanced) e o uso de `EffectsSimplePanel`; passa a decidir entre `EffectInspector` (quando `selectedEffectId`) e as propriedades do clipe. `KeyframeEditor` + `AnimSection` ficam sempre visíveis para o clipe.
- Controles de imagem (brilho/contraste/saturação) já existem como `AnimProp` em `src/lib/keyframes.ts`; serão agrupados numa seção "Imagem" própria dentro de `AnimSection` em vez de listados soltos.
- Transição do clipe: reaproveitar a lógica de `TransitionsPanel.tsx` extraindo um componente `ClipTransitionControls` usado tanto no módulo quanto no painel direito (sem alterar `setTransition`).
- Exclusividade de seleção: em `src/state/editor-store.ts`, `select`/`selectMany` zeram `selectedEffectId`; `selectEffect` zera `selectedClipId`.
- Nenhuma mudança em `effect-presets.ts`, `export-project.ts` ou no runtime de render/exportação — é reorganização de UI.
