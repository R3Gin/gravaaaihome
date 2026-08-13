# Alinhar clipes e edição em ondulação (ripple) na timeline

Duas melhorias na timeline do Editor.

## 1. Botão "Ajustar"

Novo botão na barra de ferramentas da timeline (ao lado de "Imantar"), com ícone de alinhamento.

Ao clicar:
- Todos os clipes de cada faixa são encostados uns nos outros, eliminando os buracos deixados pelos cortes.
- A ordem atual dos clipes é preservada; o primeiro clipe de cada faixa vai para 0:00.
- Vídeo e áudio vinculados (mesmo grupo de link) recebem o mesmo deslocamento, para não perder o sincronismo.
- Ação única no histórico: um Ctrl+Z desfaz o ajuste inteiro.
- Fica desabilitado quando não há nenhum buraco para fechar.

## 2. Puxar o restante ao mover ou apagar um corte (ripple)

Novo botão de alternância "Ondulação" na mesma barra (ativo por padrão desligado, destacado em vermelho quando ligado).

Com a ondulação ligada:
- Ao arrastar um clipe para o lado, todos os clipes seguintes daquela faixa acompanham o movimento, mantendo a distância entre eles — em vez de o clipe arrastado empurrar/pular para a lacuna livre.
- Ao apagar um clipe (Deletar), os clipes seguintes recuam para fechar o espaço automaticamente.
- Clipes vinculados (áudio+vídeo) se deslocam juntos, e a mesma quantidade é aplicada às faixas envolvidas para não dessincronizar.

Com a ondulação desligada, o comportamento atual (mover livre com imã) continua igual.

## Detalhes técnicos

- `src/state/editor-store.ts`
  - novo estado `rippleEnabled` + `toggleRipple`.
  - nova ação `alignAllClips()`: para cada faixa, ordena por `startTime`, reatribui `startTime` sequencialmente a partir de 0 e aplica o mesmo delta aos parceiros de `linkGroupId`.
  - `moveSelection` / `moveClip`: quando `rippleEnabled`, desviar para uma rotina que aplica o delta ao clipe arrastado e a todos os clipes com `startTime` maior na mesma faixa (e nas faixas dos vinculados), em vez de usar `freeStart`.
  - `removeSelected` / `removeClip`: quando `rippleEnabled`, recuar os clipes posteriores pelo tamanho do trecho removido.
  - manter tudo dentro do mesmo `write()` para gerar uma única entrada de undo.
- `src/components/editor/Timeline.tsx`: dois botões novos na toolbar seguindo o estilo do botão "Imantar" (ícone `AlignHorizontalJustifyStart` e `Waves`/`MoveHorizontal`), com `title` explicativo.
- Nenhuma mudança na exportação: as posições finais dos clipes já alimentam o render.
