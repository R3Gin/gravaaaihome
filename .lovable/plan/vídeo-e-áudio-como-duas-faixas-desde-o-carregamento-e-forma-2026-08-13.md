# Vídeo e áudio como duas faixas desde o carregamento (e forma de onda correta)

Dois ajustes no editor: o áudio já nasce como faixa própria ao subir o vídeo, e a forma de onda passa a acompanhar o clipe de áudio de verdade quando ele é movido.

## 1. Duas faixas ao carregar o vídeo

- Ao carregar um vídeo que tem áudio, a timeline já mostra **Vídeo** e **Áudio** com um clipe cada, alinhados no mesmo trecho.
- Os dois nascem **vinculados** (ícone de corrente): mover, cortar ou apagar um faz o mesmo no outro — o "ímã nativo" continua valendo.
- O botão passa a ser **"Desanexar"** (quebra o vínculo) e **"Vincular"** (refaz), no lugar de "Separar áudio".
- Se o arquivo não tiver trilha de áudio, só a faixa de vídeo aparece.
- Reprodução e exportação continuam com um único áudio (o clipe de áudio manda; o vídeo fica mudo internamente), sem eco.

## 2. Forma de onda que segue o clipe

Hoje a onda é desenhada na faixa de áudio usando a posição dos **clipes de vídeo**. Por isso, ao mover o áudio desanexado, a onda fica parada no lugar antigo e o clipe verde aparece vazio em outro ponto — o efeito "bugado" do print.

- A onda passa a ser desenhada a partir dos **clipes da própria faixa de áudio** (posição, trecho de origem e velocidade de cada um), recortada dentro dos limites do clipe.
- Quando não existe clipe de áudio (caso de projeto antigo), mantém o desenho baseado no vídeo como hoje.
- A onda acompanha arraste, corte e trim em tempo real, e some junto com o clipe.

## Notas técnicas

- `src/state/editor-store.ts`: em `loadSource`, detectar trilha de áudio e criar clipe de áudio espelhado com `linkGroupId` compartilhado e `muted: true` no clipe de vídeo; sem áudio, comportamento atual.
- `src/components/editor/Timeline.tsx`: `AudioWaveform` recebe os clipes da faixa de áudio (fallback para `video`), desenha por clipe usando `startTime`/`sourceInStart`/`sourceInEnd`; rótulo do botão vira "Desanexar".
- `src/components/editor/Preview.tsx` e `src/lib/export-project.ts`: já tratam `muted` + clipe de áudio; validar que o caminho "áudio criado no load" não duplica som.
