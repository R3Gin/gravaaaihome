# Timeline funcional: seleção múltipla, áudio destacável e faixas dinâmicas

Três frentes no editor: selecionar vários clipes de verdade, separar o áudio do vídeo quando você quiser, e uma timeline que só mostra as faixas que existem — com nomes claros e movimento suave.

## 1. Seleção múltipla

Hoje só existe um clipe selecionado por vez (`selectedClipId`). Passa a existir uma seleção com vários:

- Clique simples: seleciona um (como hoje).
- Ctrl/Cmd + clique: adiciona ou remove da seleção.
- Shift + clique: seleciona o intervalo entre o último clicado e o atual, na mesma faixa.
- Laço (marquee): arrastar no espaço vazio da timeline desenha um retângulo e seleciona tudo que ele tocar, inclusive em faixas diferentes.
- Ctrl/Cmd + A: seleciona todos os clipes ("puxar todos").
- Esc ou clique no vazio: limpa.

Com vários selecionados:
- Arrastar um move todos juntos, mantendo as distâncias entre eles; o ímã continua valendo (usa o clipe arrastado como referência e checa se algum encostaria em outro).
- Delete apaga todos; duplicar duplica todos; o painel de propriedades mostra "N clipes selecionados" e edita em lote o que faz sentido (volume, velocidade, cor, opacidade).
- Todos os selecionados ganham a borda de destaque.

## 2. Áudio ligado/desligado do vídeo

Hoje o áudio vive dentro do clipe de vídeo e não existe separado. Passa a haver vínculo explícito:

- Ao carregar um vídeo, ele continua como está: um clipe de vídeo com áudio embutido, grudados por padrão.
- Botão / menu de contexto **"Separar áudio"**: cria um clipe de áudio na faixa de áudio com o mesmo trecho de origem, e o vídeo fica mudo. Os dois nascem **vinculados** — mover, cortar ou apagar um faz o mesmo no outro, como um ímã nativo.
- Botão **"Desvincular"**: quebra o elo; a partir daí cada um se move, corta e ajusta sozinho.
- Botão **"Reagrupar áudio"**: volta o áudio para dentro do clipe de vídeo quando eles ainda são compatíveis.
- Indicador visual de elo (ícone de corrente) nos clipes vinculados.
- A exportação respeita o resultado: áudio separado entra como faixa própria na mixagem; vídeo mudo exporta sem trilha.

## 3. Timeline dinâmica e legível

- As faixas Vídeo, Áudio, Efeitos e Texto hoje aparecem sempre, mesmo vazias. Passam a aparecer **só quando têm conteúdo** — a faixa surge quando o primeiro clipe é adicionado e some quando esvazia (com animação de entrada/saída, sem salto brusco).
- Enquanto não houver nada, a timeline mostra uma faixa-base do vídeo e um aviso curto de "arraste um arquivo aqui".
- Cabeçalhos com nome claro e ícone por tipo: **Vídeo**, **Áudio**, **Efeitos**, **Texto**, **Legendas**, mais contagem de clipes. Faixas de mídia importada ganham o nome do arquivo.
- Ações rápidas por faixa no cabeçalho: silenciar (áudio), ocultar (vídeo/texto/efeitos) e bloquear contra edição.
- Polimento de movimento: transições suaves ao selecionar, arrastar, encaixar no ímã e ao aparecer/sumir faixas; feedback claro no clipe imantado.

## Notas técnicas

- `src/state/editor-store.ts`: troca de `selectedClipId` por `selectedClipIds: string[]` (com getter de compatibilidade para o Inspector e atalhos existentes), novas ações `selectMany`, `toggleSelect`, `selectAll`, `moveSelection`, `removeSelected`, `detachAudio`, `linkClips`, `unlinkClips`, `mergeAudio`. Clipes ganham `linkGroupId?: string` e `muted?: boolean`; faixas ganham `hidden?`, `locked?`, `muted?`.
- `src/components/editor/Timeline.tsx`: laço de seleção, arraste em grupo reutilizando `freeStart`/`applySnap` de `src/lib/snap.ts` (validando o grupo inteiro antes de gravar), faixas renderizadas a partir de `tracks.filter(t => t.clips.length > 0)` com animação de altura.
- `src/components/editor/Inspector.tsx`: modo multi-seleção com edição em lote e botões de separar/vincular áudio.
- `src/lib/export-project.ts`: mixagem de clipes de áudio independentes e respeito ao `muted` do vídeo.
