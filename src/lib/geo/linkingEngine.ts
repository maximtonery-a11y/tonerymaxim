type LinkableEntity = {
  brandSlug?: string;
  printerSlug?: string;
  oemSlug?: string;
  categorySlug?: string;
};

export function relatedLinks(entity: LinkableEntity | null | undefined) {
 const safeEntity = entity || {};
 return {
  brand:`/znacky/${safeEntity.brandSlug||''}`,
  printer:`/tlaciarne/${safeEntity.printerSlug||''}`,
  oem:`/oem/${safeEntity.oemSlug||''}`,
  category:`/${safeEntity.categorySlug||''}`
 };
}
