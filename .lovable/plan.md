# Etapa 2 do Editor — silêncio, legendas e ruído

As três ferramentas voltam agora ligadas ao estado central (`editor-store`), usando o que já existe: `detectSilences`/`detectSpeechBlocks` em `src/lib/audio-tools.ts`, a ação `cutRanges` da store e o filtro `denoise` já suportado na exportação ffmpeg.

## 1. Cortador de silêncio

- Botão "Detectar silêncios" na barra de ações da timeline.
- Analisa o áudio do vídeo original (Web Audio, RMS por janela de 30ms) e marca os trechos silenciosos como faixas sombreadas sobre a régua da timeline.
- Painel de confirmação flutuante: slider de sensibilidade (recalcula ao vivo), duração mínima do silêncio, contagem de trechos e tempo total que será removido.
- "Remover todos" chama `cutRanges`, que já divide os clipes e reencaixa o resto sem buracos — um único passo de desfazer. "Cancelar" limpa as marcações.
- Silêncios detectados ficam em estado local do editor (não são salvos no projeto), então recortar de novo é só reabrir o painel.

## 2. Legendas automáticas (Whisper no navegador)

- Nova entrada "Legendas" na sidebar esquerda.
- Botão "Gerar legendas automaticamente": extrai o áudio, roda Whisper (`@huggingface/transformers`, modelo `Xenova/whisper-small` quantizado, em WebGPU quando disponível e WASM como reserva) inteiramente no dispositivo — nada é enviado para servidor.
- Primeira execução baixa o modelo (~150 MB) e mostra progresso real de download e de transcrição; o modelo fica em cache do navegador para as próximas vezes.
- Cada segmento com timestamp vira um clipe de texto na faixa Texto, já posicionado no tempo — editável, arrastável e com trim como qualquer outro clipe.
- Painel de estilo aplicado a todas as legendas de uma vez: fonte, tamanho, cor, fundo e posição (rodapé, meio, topo).
- Idioma: detecção automática por padrão, com opção de forçar Português.
- Se o WebGPU/WASM falhar ou o vídeo não tiver áudio, mensagem clara com opção de tentar de novo; existe também o modo alternativo por blocos de fala (sem texto) para marcar tempos manualmente.

## 3. Remoção de ruído

- Aba "Áudio" no painel direito quando um clipe de vídeo/áudio está selecionado.
- Toggle "Reduzir ruído de fundo" grava `denoise` no clipe (já respeitado na exportação: highpass 90 Hz + afftdn + normalização).
- Preview antes/depois: reproduz o trecho selecionado com uma cadeia Web Audio equivalente (highpass + noise gate por RMS), alternando entre original e tratado, para conferir antes de exportar.
- Volume e ganho continuam no mesmo painel.

## Notas técnicas

- Nova dependência: `@huggingface/transformers` (Whisper), carregada por import dinâmico dentro de um Web Worker para não travar a interface; nada disso entra no bundle inicial nem roda no SSR.
- Novos arquivos: `src/lib/whisper-worker.ts`, `src/lib/captions.ts` (segmentos → clipes de texto) e `src/components/editor/panels/` com `SilencePanel`, `CaptionsPanel` e a aba de áudio do Inspector.
- `audio-tools.ts` ganha um noise gate para o preview em tempo real; a exportação continua pelo ffmpeg.
- Nenhuma mudança na estrutura de layout nem na identidade visual (fundo escuro, acentos vermelhos).
