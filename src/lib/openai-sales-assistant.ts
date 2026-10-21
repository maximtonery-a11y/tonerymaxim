import { aiKnowledge } from "../data/ai-knowledge.ts";
import { requestOpenAi } from './openai-request.ts';

type OpenAiAssistantResult = {
  status: "answer" | "clarify" | "handoff";
  answer: string[];
  confidence: number;
};

function env(name: string) {
  return String(process.env[name] || (import.meta as any).env?.[name] || "").trim();
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
  return env("OPENAI_ASSISTANT_ENABLED") === "1" && env("OPENAI_API_KEY").length >= 20;
}

export async function answerWithOpenAi(message: string, page = "", verifiedFacts: string[] = [], history: Array<{ role: string; content: string }> = []) {
  if (!isOpenAiAssistantEnabled()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    numberEnv("OPENAI_TIMEOUT_MS", 12_000, 1_500, 15_000),
  );

  const instructions = [
    "Ste Tomáš, AI poradca slovenského e-shopu ToneryMAXIM.",
    "Odpovedajte prirodzenou slovenčinou, vecne, jednoducho a zdvorilo, ako ochotný poradca pri nákupe. Zákazníkovi vykajte.",
    "Začnite priamou odpoveďou na zákazníkovu otázku. Pri doplňujúcej otázke nadviažte na jej predmet a neopakujte celý predchádzajúci výklad.",
    "Za e-shop hovorte v prvej osobe množného čísla: napríklad V našej ponuke máme tieto produkty. Pri vlastnej pomoci použite napríklad Rád vám pomôžem s výberom.",
    "Neopisujte interné vyhľadávanie, katalóg, databázu ani overené informácie. Nepoužívajte úvody Overil som aktuálny katalóg, Podľa katalógu, Rozumiem vašej požiadavke ani Ako AI asistent.",
    "Ak chýba dôležitý údaj, povedzte stručne ktorý a položte jednu konkrétnu otázku. Nepridávajte všeobecný zoznam všetkého, s čím dokážete pomôcť.",
    "Nepredstierajte, že ste človek alebo ste vykonali osobné preverenie. Nepoužívajte prehnané uisťovanie, nútené nadšenie ani nevyžiadané oslovenia.",
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
    verifiedFacts.length ? `\nOVERENÝ KONTEXT PRE TÚTO OTÁZKU:\n${verifiedFacts.map((fact) => `- ${fact}`).join("\n")}` : "",
  ].join("\n");

  try {
    const result = await requestOpenAi({
      apiKey: env("OPENAI_API_KEY"),
      body: JSON.stringify({
        model: env("OPENAI_MODEL") || "gpt-5.6-sol",
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
                text: [
                  `Aktuálna stránka: ${page || "neuvedená"}`,
                  history.length ? `Kontext konverzácie:\n${history.slice(-20).map((item) => `${item.role}: ${item.content}`).join("\n")}` : "",
                  `Otázka zákazníka: ${message}`,
                ].filter(Boolean).join("\n"),
              },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (result.failure) return null;
    const response = result.response;

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
