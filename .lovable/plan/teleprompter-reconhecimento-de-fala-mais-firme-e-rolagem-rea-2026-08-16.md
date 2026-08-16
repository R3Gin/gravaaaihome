# Teleprompter: reconhecimento de fala mais firme e rolagem realmente suave

Dois problemas hoje: o acompanhamento se perde (avança demais, trava ou volta) e a rolagem dá saltos a cada frase, o que parece "bagunçado".

## 1. Rolagem suave e contínua (fim dos saltos)

- Trocar o `scrollTo({ behavior: "smooth" })` disparado a cada troca de segmento por uma animação própria em `requestAnimationFrame`: um alvo de scroll é recalculado a cada atualização do cursor e a posição atual persegue esse alvo com interpolação suave (critically damped / lerp ~0.12 por quadro). Resultado: o texto desliza continuamente, sem parar e arrancar.
- O alvo passa a ser calculado por **palavra**, não por frase: posição interpolada entre o início e o fim do segmento atual conforme o cursor avança dentro dele. Assim a leitura desliza palavra a palavra em vez de pular de bloco em bloco.
- Nunca rolar para trás bruscamente: retrocessos pequenos são absorvidos (alvo só recua se a diferença for grande, ex. reinício manual).
- Manter a linha de leitura fixa em ~35% da altura, com uma faixa morta (dead zone) de alguns pixels para não micro-mexer.
- Respeitar `prefers-reduced-motion`: nesse caso, salto direto sem animação.

## 2. Reconhecimento mais rígido e estável

- **Sem saltos para frente:** limitar o avanço por atualização a poucas palavras acima do que foi realmente falado (hoje a janela de 30 palavras permite pulos). Avanço grande só é aceito com score alto e confirmado em duas leituras seguidas.
- **Confirmação por resultado final:** o texto interino move o cursor de forma provisória; só o resultado final consolida a posição. Evita o vaivém típico do Chrome, que reescreve o interino.
- **Limiar por tamanho da amostra:** cauda curta (3 palavras) exige score mais alto (~0.8); cauda longa (8 palavras) aceita ~0.6. Reduz falso positivo em palavras comuns ("que", "para").
- **Anti-travamento:** se houver fala reconhecida mas nenhum casamento por alguns segundos, ampliar temporariamente a janela de busca para reengatar, e voltar ao normal depois.
- **Filtro de ruído:** ignorar resultados com uma única palavra curta e alternativas de baixa confiança.
- Manter a arquitetura atual: reconhecimento sempre na janela principal, PiP apenas renderizando o estado (fonte única de verdade).

## 3. Destaque de leitura mais natural

- Transição de opacidade das palavras lidas em ~180ms com `cubic-bezier(0.2, 0, 0, 1)`, sem mudança de peso/cor que cause reflow.
- Palavra atual levemente destacada; as próximas 1–2 linhas com opacidade intermediária, criando um gradiente de leitura em vez de blocos ligados/desligados.

## Arquivos

- `src/lib/speech-follow.ts` — limiar adaptativo por tamanho de cauda, limite de avanço, janela de reengate.
- `src/hooks/useSpeechFollow.ts` — separação interino/final, confirmação de saltos, anti-travamento.
- `src/components/Teleprompter.tsx` — animação de scroll em rAF com alvo por palavra, dead zone, reduced-motion e ajuste do destaque.

Sem mudanças no fluxo de gravação, no Document PiP nem na exportação.
