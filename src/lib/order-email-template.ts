export type OrderTemplateEmailRequest = {
  id: string;
  template_slug: string;
  label: string;
  subject: string;
  message: string;
  created_at: string;
};

export function readOrderTemplateEmailRequest(raw: string): OrderTemplateEmailRequest | null {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    for (const key of ["id", "template_slug", "label", "subject", "message", "created_at"]) {
      if (typeof value[key] !== "string" || !value[key].trim()) return null;
    }
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id)) return null;
    if (!/^tm-[a-z0-9-]{1,60}$/.test(value.template_slug)) return null;
    if (Array.from(value.label).length > 120 || Array.from(value.subject).length > 250 || Array.from(value.message).length > 20000 || !Number.isFinite(Date.parse(value.created_at))) return null;
    return value as OrderTemplateEmailRequest;
  } catch { return null; }
}
