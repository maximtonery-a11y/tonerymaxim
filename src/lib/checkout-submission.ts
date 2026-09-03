import { createHash } from "node:crypto";
import { withOrderIdempotency, type OrderIdempotencyResult } from "./order-idempotency.ts";

type CheckoutSubmissionResult = OrderIdempotencyResult & {
  endpoint: string;
  fingerprint: string;
  payload: {
    body: string;
    contentType: string;
  };
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry)]));
}

function fingerprint(body: unknown): string {
  const canonical = body && typeof body === "object"
    ? Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([key]) => key !== "createdAt"))
    : body;
  return createHash("sha256").update(JSON.stringify(stable(canonical))).digest("hex");
}

function conflict(message: string): Response {
  return Response.json({ ok: false, error: message }, {
    status: 409,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function withCheckoutSubmission(
  requestId: string,
  endpoint: "order" | "gopay",
  body: unknown,
  work: () => Promise<Response>,
): Promise<Response> {
  const cleanId = String(requestId || "").trim();
  if (!cleanId) return work();
  const bodyFingerprint = fingerprint(body);

  let result: CheckoutSubmissionResult;
  try {
    result = await withOrderIdempotency<CheckoutSubmissionResult>(`checkout-submit-${cleanId}`, async () => {
      const response = await work();
      return {
        ok: response.ok,
        status: response.status,
        endpoint,
        fingerprint: bodyFingerprint,
        payload: {
          body: await response.text(),
          contentType: response.headers.get("content-type") || "application/json; charset=utf-8",
        },
        createdAt: new Date().toISOString(),
      };
    });
  } catch (error: any) {
    if (Number(error?.status || 0) === 409) return conflict(error.message);
    throw error;
  }

  if (result.endpoint !== endpoint || result.fingerprint !== bodyFingerprint) {
    return conflict("Tento pokus o objednávku už bol odoslaný s iným spôsobom platby alebo s inými údajmi. Obnovte pokladňu a skontrolujte vytvorenú objednávku.");
  }

  return new Response(result.payload.body, {
    status: result.status,
    headers: {
      "Content-Type": result.payload.contentType,
      "Cache-Control": "no-store",
      "X-TM-Idempotent-Replay": result.createdAt,
    },
  });
}
