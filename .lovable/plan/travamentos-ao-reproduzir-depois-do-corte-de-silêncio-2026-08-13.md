# Travamentos ao reproduzir depois do corte de silêncio

Você já pediu (e com razão) que eu não aplique correção sem provar onde a pausa acontece. Então o plano tem duas fases: primeiro medir, depois corrigir só o que a medição apontar.

## Fase 1 — Provar onde a pausa acontece

Instrumentação temporária no player, registrando por quadro:
- intervalo real entre quadros (detectar saltos acima de ~50 ms);
- se o `<video>` estava em `seeking`, `paused` ou aguardando dados (`waiting`/`stalled`) no momento do salto;
- se o decodificador reserva estava pronto (`ready`) na hora da emenda ou se caiu no seek de emergência;
- quanto tempo o navegador levou entre pedir o seek e o evento `seeked`;
- duração dos clipes gerados pelo corte de silêncio.

Reprodução automatizada: projeto com corte de silêncio real (vídeo com pausas de fala), executado em navegador headless, com o relatório agregando os saltos por causa. Com isso fica registrado, em números, se o congelamento vem do seek, do decodificador reserva não pronto, ou do trabalho de interface a cada quadro.

## Fase 2 — Correções, condicionadas ao que a medição mostrar

Hipóteses já identificadas na leitura do código, em ordem de suspeita:

1. **Janela de preparo curta demais.** O próximo trecho só começa a ser preparado 0,6 s antes da emenda. Depois do corte de silêncio, muitos clipes duram menos que isso, então não dá tempo de preparar e o player cai no seek na hora — que é justamente o que trava. Correção: preparar o próximo trecho assim que o atual começa, sem janela fixa.
2. **Só existem dois decodificadores.** Em sequências de cortes curtos e seguidos, o reserva ainda está ocupado com o trecho anterior quando o seguinte já precisa dele. Correção: usar um pequeno conjunto rotativo (três elementos) e preparar sempre o próximo livre.
3. **Trabalho de interface a cada quadro.** O tempo atual é gravado no estado a cada quadro, e o sincronizador de áudio roda a cada mudança de estado, mexendo no DOM. Correção: separar o relógio de reprodução do estado da interface — a agulha e os painéis passam a atualizar em ritmo reduzido, sem afetar a precisão do player.
4. **Emendas quase contíguas.** Cortes cujo fim e início praticamente se tocam podem ser tocados direto, sem troca de decodificador. Correção: ampliar levemente a tolerância de continuidade.

Aplico apenas os itens que a medição confirmar como causa, e mostro o antes/depois com os mesmos números.

## Fase 3 — Validação

Rodar de novo a mesma medição depois da correção e comparar: número de saltos acima de 50 ms e maior salto observado, no mesmo projeto cortado por silêncio. Só considero resolvido se os saltos sumirem da medição, não por impressão visual.

## Detalhes técnicos

- Arquivos envolvidos: `src/components/editor/Preview.tsx` (loop de reprodução, duplo buffer de vídeo e áudio), `src/state/editor-store.ts` (gravação de `currentTime`), possivelmente `src/components/editor/Timeline.tsx` (leitura da agulha).
- A exportação em MP4 não muda: ela já reconstrói quadro a quadro e não sofre desse problema.
- A instrumentação da Fase 1 é temporária e sai do código antes da entrega.
