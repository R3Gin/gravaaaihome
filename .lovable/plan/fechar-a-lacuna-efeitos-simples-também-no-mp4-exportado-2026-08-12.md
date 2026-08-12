# Fechar a lacuna: efeitos simples também no MP4 exportado

Os presets do modo Simples já funcionam de ponta a ponta no preview (testado no navegador: aplicar "Zoom suave", clicar no ponto do vídeo e o preview realmente amplia e desloca para aquele ponto; chips e aba Avançado refletem os keyframes gerados). O que falta é a exportação: o arquivo MP4 final não reproduz parte desses efeitos.

## O que está faltando hoje

Verificado em `src/lib/export-project.ts` e `src/lib/ffmpeg-convert.ts`:

- **Ponto do zoom é ignorado no MP4.** A exportação só envia a escala (`zoomKeys`); o recorte do ffmpeg é sempre centralizado. Resultado: no preview o zoom vai para o ponto clicado, no arquivo exportado ele vai para o centro.
- **Opacidade animada em clipes de vídeo é ignorada.** Presets "Aparecer com fade", "Sumir com fade", "Piscar" e a parte de fade do "Deslizar"/"Crescer" não aparecem no MP4 quando aplicados a um clipe de vídeo.
- **Deslocamento de posição em clipes de vídeo é ignorado.** Os presets "Deslizar" e "Tremer" em vídeo não têm efeito no arquivo final.

Textos e overlays não são afetados por isso (seguem outro caminho de renderização).

## O que fazer

1. Levar as chaves de posição (`keyframes.position`) do clipe de vídeo até a exportação, junto com as de zoom.
2. No filtro de recorte do ffmpeg, deslocar o recorte pelo pan animado em vez de fixá-lo no centro — usando a mesma convenção de unidades do preview, para que o ponto clicado fique no mesmo lugar nos dois.
3. Levar as chaves de opacidade (`keyframes.opacity`) do clipe de vídeo e aplicá-las como escurecimento/fade animado sobre fundo preto, apenas quando existirem chaves (para não pesar a exportação de projetos sem esses efeitos).
4. Conferir o resultado com uma exportação real curta, comparando um quadro do meio do vídeo exportado com o preview no mesmo instante.

## Detalhes técnicos

- `src/lib/export-project.ts`: no `videoClips.map`, além de `zoomKeys`/`rotateKeys`, montar `panKeys` a partir de `c.keyframes.position` (mais o `x`/`y` do legado `zoomKeyframes`, hoje descartado) e `opacityKeys` a partir de `c.keyframes.opacity`; incluir ambos em `TimelineClip`.
- `src/lib/ffmpeg-convert.ts`: estender a interface `TimelineClip` com os novos campos; gerar expressões temporais com o mesmo utilitário `valueExpr` já usado em `rotateKeys`. O `crop` da linha ~475 passa de `x='(iw-ow)/2'` para `x='(iw-ow)/2*(1+(panX))'` (idem para `y`), replicando a fórmula de `containRect` em `src/lib/preview-compose.ts`. A opacidade entra como um filtro extra condicional (multiplicação do luma por expressão em `T`), aplicado só quando `opacityKeys.length > 0`.
- Sem mudança em `src/lib/effect-presets.ts`, no store ou nos painéis — os presets já geram keyframes comuns; o ajuste é só no caminho de exportação.
- Ponto de atenção conhecido: quando o vídeo é exibido com barras (proporção diferente da do projeto), a escala do pan no preview usa a metade da barra em vez da metade da largura; alinhar a exportação ao comportamento do preview e, se houver divergência visível no teste, corrigir a fórmula nos dois lugares de uma vez.
