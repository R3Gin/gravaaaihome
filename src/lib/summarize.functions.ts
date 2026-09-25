import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";

const schema = z.object({
  text: z.string().min(20).max(120_000),
});

// Limite por IP para ninguém gastar os créditos de IA chamando a função em loop.
// Fica em memória de cada instância do servidor: não é perfeito, mas corta abuso simples.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
const hits = new Map<string, number[]>();

function checkRateLimit(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    throw new Error("Muitos resumos em pouco tempo. Tente novamente em alguns minutos.");
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, list] of hits) {
      if (list.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
    }
  }
}

/** Recusa chamadas que o navegador marca como vindas de outro site. */
function assertSameOrigin() {
  const fetchSite = getRequestHeader("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new Error("Requisição não permitida.");
  }
}

/**
 * Gera um resumo do texto transcrito usando a IA da Lovable Cloud.
 * Apenas o TEXTO é enviado — nunca o vídeo ou o áudio.
 */
export const summarizeTranscript = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    assertSameOrigin();
    const ip =
      getRequestHeader("cf-connecting-ip") ||
      getRequestIP({ xForwardedFor: true }) ||
      "desconhecido";
    checkRateLimit(ip);

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("IA indisponível: chave não configurada.");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          {
            role: "system",
            content:
              "Você resume transcrições de vídeos em português do Brasil. Escreva de 2 a 4 parágrafos curtos, em texto corrido, cobrindo os pontos principais, decisões e próximos passos quando existirem. Não invente informação e não use marcadores.",
          },
          { role: "user", content: `Resuma esta transcrição:\n\n${data.text}` },
        ],
      }),
    });

    if (response.status === 429) throw new Error("Muitas requisições. Tente novamente em instantes.");
    if (response.status === 402) throw new Error("Créditos de IA esgotados no workspace.");
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Falha ao gerar o resumo (${response.status}). ${detail.slice(0, 200)}`);
    }

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const summary = json.choices?.[0]?.message?.content?.trim();
    if (!summary) throw new Error("A IA não retornou um resumo.");
    return { summary };
  });
