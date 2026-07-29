import { aiKnowledge } from "../data/ai-knowledge.ts";

type OpenAiAssistantResult = {
  status: "answer" | "clarify" | "handoff";
  answer: string[];
  confidence: number;
};

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";

function env(name: string) {
  return String(import.meta.env[name] || process.env[name] || "").trim();
}

function numberEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(env(name));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function knowledgeContext() {
  return aiKnowledge
    .map((item) => [
      `Téma: ${item.title}`,
      ...item.answer.map((line) => `- ${line}`),
    ].join("\n"))
    .join("\n\n");
}

function responseText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;

  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type !== "message") continue;
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }

  return "";
}

export function validateGroundedOpenAiResult(value: unknown): OpenAiAssistantResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const status = String(candidate.status || "");
  if (!["answer", "clarify", "handoff"].includes(status)) return null;

  const answer = Array.isArray(candidate.answer)
    ? candidate.answer.map((line) => String(line || "").trim()).filter(Boolean).slice(0, 4)
    : [];
  const confidence = Number(candidate.confidence);

  if (!answer.length || !Number.isFinite(confidence)) return null;
  return {
    status: status as OpenAiAssistantResult["status"],
    answer,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

export function isOpenAiAssistantEnabled() {
  return env("OPENAI_ASSISTANT_ENABLED") !== "0" && env("OPENAI_API_KEY").length >= 20;
}

export async function answerWithOpenAi(message: string, page = "") {
  if (!isOpenAiAssistantEnabled()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    numberEnv("OPENAI_TIMEOUT_MS", 12_000, 3_000, 30_000),
  );

  const instructions = [
    "Ste Tomáš, online poradca slovenského e-shopu ToneryMAXIM.",
    "Odpovedajte po slovensky, vecne, jednoducho a zdvorilo.",
    "Smiete použiť iba fakty zo sekcie OVERENÉ INFORMÁCIE nižšie.",
    "Nikdy nevymýšľajte produkt, cenu, sklad, kompatibilitu, termín, stav objednávky ani firemnú politiku.",
    "Produkty a kompatibilitu vyhľadáva samostatne katalóg. Ak sa otázka týka produktu alebo tlačiarne a nemáte v overených informáciách presný podklad, požiadajte o značku a presný model tlačiarne alebo celé označenie náplne.",
    "Ak otázka nie je jednoznačná alebo na ňu overené informácie nestačia, nastavte status na clarify a položte jednu konkrétnu doplňujúcu otázku.",
    "Ak je potrebný človek, nastavte status na handoff a použite iba uvedený telefón alebo e-mail.",
    "Status answer použite iba vtedy, keď je celá odpoveď priamo podložená overenými informáciami.",
    "Vráťte najviac štyri krátke odseky bez markdownu.",
    "",
    "OVERENÉ INFORMÁCIE:",
    knowledgeContext(),
  ].join("\n");

  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env("OPENAI_MODEL") || "gpt-5.6",
        store: false,
        reasoning: { effort: env("OPENAI_REASONING_EFFORT") || "low" },
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "tonerymaxim_grounded_answer",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                status: { type: "string", enum: ["answer", "clarify", "handoff"] },
                answer: {
                  type: "array",
                  minItems: 1,
                  maxItems: 4,
                  items: { type: "string", minLength: 1, maxLength: 500 },
                },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["status", "answer", "confidence"],
            },
          },
        },
        max_output_tokens: numberEnv("OPENAI_MAX_OUTPUT_TOKENS", 450, 150, 1_200),
        instructions,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Aktuálna stránka: ${page || "neuvedená"}\nOtázka zákazníka: ${message}`,
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const text = responseText(payload);
    if (!text) return null;

    const parsed = validateGroundedOpenAiResult(JSON.parse(text));
    if (!parsed) return null;

    if (parsed.status === "answer" && parsed.confidence < 0.72) {
      return {
        status: "clarify" as const,
        answer: ["Aby som vám odpovedal správne, upresnite prosím otázku alebo napíšte presný model tlačiarne či označenie náplne."],
        confidence: parsed.confidence,
      };
    }

    return parsed;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
