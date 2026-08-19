# Microfone ligado por padrão

A opção **Microfone** na área de gravação passa a vir marcada quando a página abre.

## O que muda
- O toggle "Microfone" inicia ativado (hoje inicia desligado).
- A permissão do microfone continua sendo pedida só no momento da captura — nada muda no fluxo de gravação nem nas outras opções (Áudio da tela, Câmera).
- Se o navegador negar o acesso ao microfone, o toggle volta sozinho para desligado e mostra a mensagem de erro já existente.

## Detalhe técnico
- `src/components/ScreenRecorder.tsx`, linha 115: `useState(false)` → `useState(true)` para `micAudio`.
- O anexo real do microfone (`attachMic`) já acontece em `startCapture` quando `micAudio` é verdadeiro, então nenhum outro ajuste é necessário.
