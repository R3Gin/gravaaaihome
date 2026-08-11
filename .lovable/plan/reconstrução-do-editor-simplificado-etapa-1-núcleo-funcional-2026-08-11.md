# Reconstrução do Editor Simplificado — Etapa 1 (núcleo funcional)

O editor atual (`/mosaicos/editor`) é um arquivo único de ~2.900 linhas onde estado, timeline e preview vivem em pedaços separados que se desincronizam — daí cortes que não cortam e seleção que não seleciona. Vou reescrevê-lo do zero em torno de um único estado central, e nesta primeira etapa entregar o núcleo funcionando de verdade, para você validar antes das ferramentas avançadas.

## O que entra na Etapa 1

**Estado central do projeto** (Zustand): duração, playhead, zoom, clipe selecionado e faixas (vídeo, áudio, texto, overlay) com clipes contendo `startTime`, `duration`, `sourceInStart`, `sourceInEnd` e as propriedades por tipo (volume, brilho/contraste/saturação, velocidade, texto, keyframes de zoom). Toda interação — cortar, arrastar, redimensionar, deletar, selecionar — passa por esse estado. Nada de manipular o DOM por fora.

**Timeline que responde**
- Posição de cada clipe calculada por `startTime × zoom`; mudar o zoom recalcula tudo.
- Clicar no clipe seleciona (borda destacada só nele) e popula o painel direito conforme o tipo; clicar no vazio limpa a seleção.
- Ferramenta Dividir: clique dentro do clipe corta no tempo exato, gerando dois clipes visualmente separados com os pontos de origem corretos.
- Arrastar clipe no tempo com biblioteca de drag real (`@dnd-kit/core`), com resolução de colisão empurrando o vizinho.
- Handles de trim nas bordas esquerda/direita, sempre respeitando os limites do arquivo original.
- Régua de tempo clicável; playhead lê o `currentTime` real do `<video>` via `requestAnimationFrame`.
- Ações: Dividir, Deletar, Duplicar.

**Preview sincronizado**
- Mostra o clipe que está sob o playhead, trocando sozinho ao cruzar limites entre clipes.
- Compõe as camadas visíveis naquele instante (vídeo base, texto, overlays).
- Proporção 16:9 / 9:16 / 1:1 com enquadramento arrastável salvo por clipe.
- Ajustes de brilho/contraste/saturação e velocidade refletidos em tempo real.

**Layout estável**
- Tela cheia sem scroll de página: barra superior fixa / sidebar + preview + painel direito / timeline fixa (mín. 200px, scroll vertical interno).
- Painéis da sidebar abrem como drawer sobre o preview, sem empurrar o layout.
- Validado em 1920, 1366 e 768px.

**Exportação MP4** com ffmpeg.wasm, aplicando cortes, ordem dos clipes, velocidade, ajustes de cor e textos, com barra de progresso real vinda dos eventos do ffmpeg.

## O que fica para a Etapa 2 (após sua validação)

Cortador de silêncio, legendas automáticas com Whisper local (Transformers.js, roda no navegador, nada sai do dispositivo), remoção de ruído, blur manual, spotlight e o painel de keyframes de zoom — todos já apoiados na estrutura de estado criada agora.

## Notas técnicas

- Novos arquivos: `src/state/editor-store.ts` (Zustand), `src/components/editor/` com Topbar, Sidebar, Preview, Inspector e Timeline separados; `VideoEditor.tsx` vira só a casca do layout.
- Dependências novas: `zustand` e `@dnd-kit/core`. Na Etapa 2 entra `@huggingface/transformers` (Whisper local).
- `src/lib/ffmpeg-convert.ts` ganha um `exportProject(project)` que traduz o estado central em `filter_complex`, substituindo o `exportTimeline` atual.
- `src/lib/editor-handoff.ts` e a entrada pelo botão "Enviar para o editor" continuam funcionando igual.
- Ferramentas da Etapa 2 hoje presentes na UI saem temporariamente da tela para não expor botões quebrados; voltam ligadas ao novo estado.
