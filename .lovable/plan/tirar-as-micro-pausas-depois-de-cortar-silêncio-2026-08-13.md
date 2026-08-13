# Tirar as micro-pausas depois de cortar silêncio

## O que está acontecendo

Confirmado no código do player (`src/components/editor/Preview.tsx`): a reprodução usa **um único elemento `<video>`** e, toda vez que o playhead chega no fim de um clipe, o loop faz `v.currentTime = próximo.sourceInStart` (função `jumpTo`, linhas 228-241). Esse reposicionamento do arquivo é um *seek* real do navegador: ele congela o último quadro por algumas dezenas/centenas de milissegundos até o novo trecho decodificar. O `<audio>` da faixa separada faz o mesmo (linha 165).

Quando você corta manualmente, existem 1 ou 2 emendas — quase não se percebe. O cortador de silêncio cria dezenas de emendas, então esses seeks acontecem a cada poucos segundos e viram o "engasgo" que você está vendo. Não é travamento de processamento: é o seek em cada emenda.

## Correção

1. **Reprodução com dois players (double-buffer).** Passa a existir um segundo `<video>` oculto, sempre pré-posicionado no início do próximo clipe enquanto o atual toca. Na emenda, o player faz apenas a troca de qual elemento é desenhado no canvas — sem seek, sem congelar quadro. O mesmo vale para o `<audio>` da faixa destacada.

2. **Pré-carregamento antecipado.** O seek do player de reserva acontece ~0,5s antes da emenda e só marca "pronto" no evento `seeked`; se não ficar pronto a tempo, cai no comportamento atual (seek direto) em vez de falhar.

3. **Menos emendas na origem.** No cortador de silêncio, silêncios separados por um trecho de fala muito curto (< ~0,25s) passam a ser unidos em um só, e cada corte mantém uma pequena margem de segurança nas pontas. Menos emendas = menos oportunidades de engasgo e resultado com corte mais natural.

4. **Sem alterar a exportação.** O MP4 exportado já é remontado quadro a quadro (WebCodecs), então ele nunca teve essas pausas — a mudança é só na pré-visualização.

## Detalhes técnicos

- `Preview.tsx`: `videoRef` vira um par (`primary`/`standby`) com um índice de qual está ativo; `paint()` desenha o elemento ativo; `jumpTo` troca o ativo quando o reserva já sinalizou `seeked` no `sourceInStart` correto. O mesmo esquema, mais simples, para o `<audio>`.
- Trechos contíguos continuam sem seek algum (comportamento atual já correto) — o double-buffer só entra em emendas descontínuas.
- `SilencePanel.tsx` / `audio-tools.ts`: pós-processamento da lista de silêncios (merge de vizinhos próximos + margem nas bordas) antes de virar marcação na timeline e antes de `cutRanges`.
- Nenhuma mudança visual no editor nem na identidade (fundo escuro, acentos vermelhos).

---

# Janela de exportação (modal com fundo em vidro)

## Como vai funcionar

Ao clicar em "Exportar MP4", em vez de a barrinha de progresso aparecer na toolbar, abre uma janela centralizada com o fundo do editor desfocado (efeito vidro) e bloqueado para cliques enquanto a exportação acontece.

Conteúdo da janela:

- Título "Exportar vídeo" e resumo do projeto: duração final, proporção (16:9 / 9:16 / 1:1) e número de clipes.
- Escolha de qualidade (Rápida 720p / Alta 1080p) com o tamanho estimado do arquivo, e o nome do arquivo editável.
- Botões "Exportar" e "Cancelar" no estado inicial.
- Durante o processo: barra de progresso com porcentagem, tempo restante estimado, etapa atual ("Preparando", "Codificando vídeo", "Finalizando arquivo") e botão "Cancelar exportação".
- Ao terminar: estado de sucesso com o nome do arquivo, botão "Baixar novamente" e "Fechar" — o download automático continua acontecendo.
- Em caso de erro: mensagem clara com "Tentar de novo" e "Fechar".

Fechar por Esc ou clique fora só é permitido quando não há exportação em andamento; durante o processo é preciso usar "Cancelar exportação" (com confirmação curta no próprio card).

## Detalhes técnicos

- Novo componente `src/components/editor/ExportDialog.tsx` (Dialog do shadcn já disponível), overlay com `bg-background/60 backdrop-blur-xl` e o card usando os tokens atuais (superfície escura, borda sutil, acento vermelho no botão principal). Nada de cores fixas.
- Cancelamento real: `ExportProjectOptions` ganha `signal?: AbortSignal`, propagado até `export-webcodecs.ts`; o laço de encode checa `signal.aborted` a cada quadro, fecha o encoder e descarta o muxer. O caminho ffmpeg.wasm faz o mesmo entre etapas.
- A escolha de qualidade sai da toolbar e passa a viver no diálogo; o botão da toolbar só abre a janela.
- Estados de progresso vêm do `onProgress` já existente; a etapa é derivada da faixa de progresso.
- Acessibilidade: foco preso no diálogo, botão principal com foco inicial, `aria-busy` durante a exportação, respeito a `prefers-reduced-motion` na animação de entrada.
