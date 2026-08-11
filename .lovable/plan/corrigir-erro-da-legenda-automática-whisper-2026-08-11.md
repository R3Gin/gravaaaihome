# Corrigir erro da legenda automática (Whisper)

## O que está acontecendo

O painel de Legendas carrega o modelo `onnx-community/whisper-small` com quantização `q8` na CPU (WebAssembly). Essa combinação específica tem pesos quantizados incompletos (falta a escala do `embed_tokens` do decoder), então o runtime não consegue criar a sessão e a transcrição falha antes de começar. Não é um bug do nosso código de áudio — é a variante do modelo escolhida.

## Correção proposta

1. **Trocar o modelo padrão para `onnx-community/whisper-base`** (multilíngue, funciona em português, bem menor e mais rápido de baixar que o `small`).
2. **Ajustar a precisão por dispositivo**: `fp32` no WebAssembly (evita o defeito da quantização) e `fp16` quando houver WebGPU.
3. **Cadeia de fallback**: se a criação da sessão falhar, tentar automaticamente a próxima combinação (WebGPU fp16 → WASM fp32 → WASM q8 no `whisper-tiny`), em vez de mostrar erro na primeira falha.
4. **Mensagem de erro melhor**: se todas as tentativas falharem, exibir texto claro em português no painel, mantendo a alternativa já existente de gerar blocos por detecção de fala.
5. **Feedback de download**: manter a barra de progresso e indicar qual modelo está sendo baixado.

## Detalhes técnicos

- Arquivo alterado: `src/lib/whisper.worker.ts` (seleção de modelo/dtype + laço de fallback).
- Ajuste menor em `src/components/editor/CaptionsPanel.tsx` apenas para o texto de erro/estado, se necessário.
- Sem mudanças na timeline, no estado do editor ou na exportação.
- Continua 100% local, dentro do Web Worker.

## Verificação

Rodar o painel de Legendas com um vídeo de teste no navegador e confirmar que o modelo carrega, o progresso aparece e as legendas são criadas como faixa de texto sincronizada.
