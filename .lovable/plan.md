# Reprodução respeitando trechos só de áudio + fim da duplicação ao vincular/desvincular

## Problema 1 — a agulha pula os trechos sem vídeo

Confirmado em `src/components/editor/Preview.tsx`: todo o relógio da reprodução é o elemento `<video>`.

- Ao dar play com a agulha num trecho sem clipe de vídeo, o código pula a agulha para o começo do próximo clipe de vídeo (`setCurrentTime(startClip.startTime + 0.001)`).
- Se não existir nenhum clipe de vídeo à frente, ele simplesmente para (`setPlaying(false)`).
- Ao terminar o último clipe de vídeo, ele para mesmo que ainda exista áudio depois.

O áudio já é totalmente guiado pela agulha (`currentTime`), então basta a agulha continuar andando que o áudio toca sozinho.

## O que muda

1. A linha do tempo passa a ter um **relógio próprio**: quando não há clipe de vídeo sob a agulha, a agulha avança em tempo real (relógio do navegador) em vez de pular ou parar.
2. Nesses trechos o preview mostra o fundo do projeto (preto) com textos/legendas/overlays normais, e o áudio, música e legendas tocam no tempo certo.
3. A reprodução só termina no **fim real do projeto** (o maior fim entre todos os clipes de qualquer faixa), não no fim do último clipe de vídeo.
4. Projeto só com áudio (nenhum vídeo) passa a tocar normalmente do início ao fim.
5. Quando a agulha entra de novo num clipe de vídeo, ele assume o comando sem salto: o vídeo é posicionado no ponto exato e continua.

## Problema 2 — áudio/vídeo duplicando ao vincular e desvincular

Confirmado em `src/state/editor-store.ts`:

- Ao carregar um vídeo, já nascem dois clipes vinculados (vídeo mudo + áudio na faixa de áudio).
- "Desanexar" apenas quebra o vínculo; o clipe de vídeo continua marcado como mudo e sem vínculo.
- Com o vínculo quebrado, o botão vira "Separar áudio" e `detachAudio` cria **outro** clipe de áudio a partir do mesmo vídeo — daí o áudio duplicado.
- "Vincular" (`toggleLink`) escolhe o clipe de áudio/vídeo mais próximo mesmo que não tenha nada a ver com ele, o que pode grudar pares errados depois de vários cortes.

### O que muda

1. "Separar áudio" só aparece quando o clipe de vídeo **realmente ainda tem áudio embutido** (não está mudo e não existe áudio correspondente na timeline). Caso contrário, o botão não aparece.
2. `detachAudio` passa a ser idempotente: se já existir um clipe de áudio com a mesma origem e o mesmo trecho, ele apenas revincula em vez de criar outro.
3. Vincular novamente passa a procurar o par certo — mesma origem e mesmo trecho de tempo/fonte, com sobreposição na linha do tempo — em vez do "mais próximo". Sem par compatível, nada acontece (com aviso curto).
4. Desanexar/vincular várias vezes seguidas volta sempre ao mesmo estado, sem acumular clipes.

## Detalhes técnicos

- `src/components/editor/Preview.tsx`: no efeito de reprodução, separar o avanço da agulha do elemento `<video>`. Criar um caminho "clock" (`performance.now()` delta × velocidade) usado quando `clipAt(tracks, "video", currentTime)` é nulo; o caminho atual do `<video>` continua igual quando há clipe. Fim da reprodução passa a usar `projectEnd = max(startTime + duration)` de todos os clipes. Quando um clipe de vídeo entra sob a agulha, aplicar seek para `sourceInStart + (currentTime - startTime) * speed` e retomar o `play()`.
- Não pausar mais quando a faixa de vídeo está vazia (`clips.length === 0`).
- `src/state/editor-store.ts`: `detachAudio` verifica se já há áudio correspondente (mesmo `sourceUrl` + `sourceInStart`/`sourceInEnd` sobrepostos) e, se houver, só aplica `linkGroupId`/`muted`. `toggleLink` passa a exigir compatibilidade (mesma origem + sobreposição de tempo).
- `src/components/editor/Timeline.tsx`: condição do botão "Separar áudio" passa a exigir `!clip.muted` e ausência de áudio correspondente.
- Sem mudanças na exportação: ela já lê os clipes de áudio como faixa própria.
