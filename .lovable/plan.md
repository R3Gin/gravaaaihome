# Ajustar o player do editor para mostrar o vídeo inteiro

Hoje o vídeo é recortado no preview: ele preenche o quadro e as bordas (topo/base ou laterais) ficam cortadas. Além disso, o palco do preview não respeita bem a altura disponível, então em telas menores ele ultrapassa a área central.

## O que muda

- O vídeo passa a caber inteiro dentro do quadro, com letterbox (barras pretas) quando a proporção do arquivo for diferente da proporção escolhida (16:9, 9:16, 1:1). Nada de corte.
- O palco do preview passa a se adaptar ao espaço disponível: encolhe junto com a janela, respeitando ao mesmo tempo largura e altura, sem estourar o layout nem criar scroll.
- Overlays (texto, blur, spotlight) continuam posicionados corretamente sobre o quadro, já que ficam ancorados ao palco.
- O reenquadramento arrastável por clipe continua funcionando quando houver zoom/escala aplicada.

## Detalhes técnicos

- `src/components/editor/Preview.tsx`: trocar `object-cover` por `object-contain` no elemento `<video>`.
- Trocar o dimensionamento fixo (`width: min(100%, 1100px)` / `height: 100%`) por um contêiner flexível que usa `max-width: 100%` e `max-height: 100%` com `aspect-ratio`, para o quadro caber sempre na área central em 1920, 1366 e 768px.
