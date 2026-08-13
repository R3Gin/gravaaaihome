# Consertar a transcrição local (Whisper no navegador)

## O que está acontecendo

A detecção de áudio funciona (por isso os marcadores/blocos de fala aparecem), mas a etapa de texto falha e cai sempre na mesma mensagem genérica. Olhando o código, há três pontos que produzem exatamente esse resultado:

1. `src/lib/whisper.worker.ts` pede primeiro timestamps **por palavra** (`return_timestamps: "word"`). Os builds ONNX de `whisper-base`/`whisper-tiny` normalmente não trazem os dados de alinhamento necessários — a chamada falha, o resultado é descartado e a segunda tentativa (por frase) roda sobre um estado já degradado.
2. Quando a segunda tentativa devolve blocos sem tempo (`timestamp` nulo), o filtro `s.end > s.start` derruba **todos** os segmentos e o worker emite o erro, mesmo tendo texto transcrito.
3. `validateTranscript` em `src/lib/captions.ts` rejeita o resultado por "densidade de texto" (exige ~1,2 caractere por segundo coberto) e por "bloco único". Fala pausada, vídeo curto ou trecho com pouca fala é reprovado mesmo estando correto.

## Correção

1. **Inverter a ordem das tentativas**: transcrever primeiro por frase (`return_timestamps: true`), que é o caminho estável. Só tentar palavra a palavra depois, como enriquecimento opcional — e se falhar, seguir com as frases em vez de invalidar tudo.
2. **Não descartar texto por falta de tempo**: quando um bloco vier sem `timestamp` final, calcular o fim pelo próximo bloco ou pela duração do áudio; se nenhum bloco tiver tempo, distribuir o texto proporcionalmente ao longo do áudio em vez de zerar a lista.
3. **Afrouxar a validação** em `captions.ts`: manter apenas as checagens que pegam lixo real (texto vazio, tokens tipo `<|nospeech|>`, repetição infinita da mesma palavra) e remover a regra de densidade e a de "bloco único" que reprovam transcrições legítimas.
4. **Mensagem de erro útil**: em vez do texto genérico, dizer o que falhou (modelo não carregou / áudio sem fala detectável / transcrição vazia) e manter a alternativa de blocos de fala.
5. **Modelo**: manter `whisper-base` multilíngue como padrão em fp32 (WASM) e fp16 (WebGPU), com a cadeia de fallback já existente — ela não é a causa do problema.

## Detalhes técnicos

- Arquivos alterados: `src/lib/whisper.worker.ts` (ordem das tentativas, reconstrução de tempos, mensagens) e `src/lib/captions.ts` (`validateTranscript` mais permissivo, erros específicos).
- Sem mudanças na timeline, no estilo de legenda, na quebra em blocos (`caption-chunking.ts`) nem na exportação.
- Continua 100% local, dentro do Web Worker — nada é enviado para servidor.

## Verificação

Rodar o painel de Legendas com um vídeo com fala em português e confirmar no console (`[legendas] worker: segmentos = N`) que os segmentos chegam com texto e tempo, e que os clipes de legenda aparecem na faixa de texto.
