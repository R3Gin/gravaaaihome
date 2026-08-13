# Ímã de verdade na timeline

Hoje o "Imantar" só gruda quando a borda do clipe chega a ~10px do alvo — na prática parece só uma marcação. A ideia é transformar isso em atração real: o clipe é puxado para a borda vizinha assim que você o empurra na direção dela.

## Comportamento novo

- **Zona de atração maior**: raio de captura passa de ~10px para ~28px de tela (constante em qualquer zoom), então basta chegar perto que o clipe pula para a borda.
- **Atração progressiva**: dentro da zona, o clipe é puxado com força crescente conforme se aproxima (efeito "grude"), em vez de mudar de posição de forma seca só no último pixel.
- **Grude ao soltar**: se ao soltar o clipe houver uma borda vizinha dentro de uma zona ampliada (~40px) e o espaço estiver livre, ele encaixa exatamente na borda, sem deixar frestas de milissegundos.
- **Prioridade dos alvos**: bordas de clipes vizinhos > agulha (playhead) > início/fim da timeline. Assim o encaixe entre pedaços ganha da agulha quando os dois estão perto.
- **Feedback visual**: a linha-guia vermelha aparece durante toda a atração e o clipe recebe um leve destaque quando está "colado", confirmando o encaixe.
- **Escape**: segurar Alt continua desligando o ímã momentaneamente para posicionamento livre.
- Vale também para trim (arrastar as pontas do clipe) e para clipes vindos da biblioteca de mídia.

## Detalhes técnicos

- `src/lib/snap.ts`: aumentar `snapTolerance` (28px), adicionar tolerância de "release" (40px) e trocar `applySnap` por uma versão com alvos priorizados (peso por tipo) que retorna também o tipo de alvo.
- `src/components/editor/Timeline.tsx`: usar a nova tolerância no arraste e no trim; ao soltar, reaplicar snap com a tolerância ampliada antes de chamar `moveClip`/`trimClip`; manter a checagem com `freeStart` para não sobrepor, mas preferir o encaixe exato quando o espaço couber.
- `src/state/editor-store.ts`: em `moveClip`, quando `snapEnabled`, aplicar o snap final às bordas dos vizinhos da faixa antes do `freeStart`, para o valor gravado ficar idêntico ao mostrado no arraste.
- Verificação: teste E2E com Playwright arrastando um clipe para perto de outro e conferindo que o `startTime` final coincide exatamente com a borda do vizinho.
