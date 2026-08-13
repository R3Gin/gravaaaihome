# Legendas: consertar a transcrição e tornar a edição instantânea

## Parte 1 — Consertar a transcrição local (Whisper no navegador)

### O que está acontecendo

A detecção de áudio funciona (por isso os marcadores/blocos de fala aparecem), mas a etapa de texto falha e cai sempre na mesma mensagem genérica. Três pontos no código produzem exatamente esse resultado:

1. `src/lib/whisper.worker.ts` pede primeiro timestamps **por palavra** (`return_timestamps: "word"`). Os builds ONNX de `whisper-base`/`whisper-tiny` normalmente não trazem os dados de alinhamento necessários — a chamada falha e a segunda tentativa roda sobre um estado já degradado.
2. Quando a segunda tentativa devolve blocos sem tempo (`timestamp` nulo), o filtro `s.end > s.start` derruba **todos** os segmentos e o worker emite erro, mesmo tendo texto transcrito.
3. `validateTranscript` em `src/lib/captions.ts` rejeita por "densidade de texto" (exige ~1,2 caractere por segundo coberto) e por "bloco único". Fala pausada ou vídeo curto é reprovado mesmo estando correto.

### Correção

1. **Inverter a ordem das tentativas**: transcrever primeiro por frase (`return_timestamps: true`), que é o caminho estável. Palavra a palavra vira enriquecimento opcional; se falhar, seguem as frases em vez de invalidar tudo.
2. **Não descartar texto por falta de tempo**: bloco sem fim recebe o início do próximo bloco ou o fim do áudio; se nenhum tiver tempo, o texto é distribuído proporcionalmente na duração.
3. **Afrouxar a validação**: manter só o que pega lixo real (texto vazio, tokens tipo `<|nospeech|>`, repetição infinita); remover as regras de densidade e de "bloco único".
4. **Mensagem de erro útil**: dizer o que falhou (modelo não carregou / áudio sem fala / transcrição vazia), mantendo a alternativa de blocos de fala.
5. **Modelo**: manter `whisper-base` multilíngue (fp32 no WASM, fp16 no WebGPU) com a cadeia de fallback atual — não é a causa.

## Parte 2 — Caixa com todas as legendas e aplicação instantânea

Hoje a lista existe, mas mudar o tamanho do bloco obriga a transcrever tudo de novo (o texto bruto não é guardado) e o efeito só pode ser global.

1. **Guardar a transcrição na sessão.** Segmentos e palavras com timing ficam no `editor-store` depois da primeira transcrição. Assim, trocar "Curto / Médio / Longo" reagrupa os blocos na hora, sem rodar o Whisper de novo.
2. **Caixa única de legendas.** Aba "Legendas" vira uma lista rolável e compacta (altura fixa, rolagem própria) com todas as falas: tempo, texto e o número do bloco. A legenda que está tocando fica destacada e a lista acompanha a agulha.
3. **Clicar para selecionar.** Um clique seleciona a legenda, leva a agulha para o início dela e destaca o clipe correspondente na timeline. Dá para selecionar várias com Ctrl/Shift.
4. **Efeito aplicado na hora.** Com legendas selecionadas, escolher um estilo na galeria aplica só nelas, instantaneamente; sem nada selecionado, aplica a todas. Vale também para fonte, tamanho, cor, fundo e posição.
5. **Editar texto no lugar.** Duplo clique no item abre edição do texto inline; salvar atualiza o clipe direto, sem retranscrever.
6. **Ações rápidas por item**: apagar legenda e "Aplicar este estilo a todas".

## Detalhes técnicos

- `src/lib/whisper.worker.ts`: ordem das tentativas, reconstrução de tempos, mensagens específicas.
- `src/lib/captions.ts`: `validateTranscript` mais permissivo e erros nomeados.
- `src/state/editor-store.ts`: guardar `transcript` (segmentos + palavras); ação `rechunkCaptions()` que reaproveita esse transcript; estilo por clipe de legenda (override sobre o estilo global) e aplicação apenas aos selecionados.
- `src/components/editor/panels/CaptionsPanel.tsx`: caixa rolável, seleção, destaque do bloco atual, edição inline e ações por item.
- `src/components/editor/Preview.tsx`: `buildFrame` passa a respeitar o estilo/animação por clipe quando existir, caindo no global quando não houver.
- Tudo continua 100% local, sem envio de áudio para servidor; timeline, chunking e exportação seguem no mesmo formato.

## Verificação

Gerar legendas de um vídeo com fala em português, confirmar que os blocos aparecem na faixa de texto, trocar o tamanho do bloco e o estilo e observar a mudança imediata na prévia, sem nova transcrição.
