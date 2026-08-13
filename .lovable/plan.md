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
