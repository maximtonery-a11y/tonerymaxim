export function chipVariant(product: Record<string, any>) {
  const key = String(product?.product_type_key || "");
  if (key !== "compatible" && key !== "renovated") return null;
  const text = `${product?.name || ""} ${product?.slug || ""} ${product?.description || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/bez[ -]?cip|no[ -]?chip/.test(text)) return { key: "no-chip", label: "BEZ ČIPU", note: "Vyžaduje pôvodný čip" };
  if (/hatona/.test(text)) return { key: "hatona", label: "HATONA", note: "Renovovaný variant Hatona" };
  if (/oem[ -]?cip/.test(text)) return { key: "oem-chip", label: "S OEM ČIPOM", note: "Originálny čip" };
  return { key: "ready-chip", label: "S ČIPOM", note: "Pripravený na použitie" };
}
