import { stripHtml, type TmProduct } from './tm-products-cache';

export const SEO_SITE_NAME = 'ToneryMaxim.sk';
export const SEO_COMPANY = {
  name: 'Roman Babčan INkarus',
  brand: 'ToneryMaxim.sk',
  email: 'info@tonerymaxim.sk',
  phone: '+421917859206',
  street: 'Tajov 265',
  postalCode: '976 34',
  city: 'Tajov',
  country: 'SK',
  ico: '37328344',
  dic: '1020059920',
  icDph: 'SK1020059920',
};

export function absoluteUrl(origin: string, value: unknown): string {
  try { return new URL(String(value || '/'), origin).toString(); } catch { return origin; }
}

export function productDescription(product: TmProduct): string {
  const base = stripHtml(product.description || product.short_description_html || product.description_html || '');
  const fallback = `${product.name}. ${product.product_type_detail_label || 'Toner alebo náplň do tlačiarne'}${product.sku ? `, označenie ${product.sku}` : ''}. Cena s DPH, dostupnosť a kompatibilné tlačiarne na ToneryMaxim.sk.`;
  return (base || fallback).replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function organizationJsonLd(origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    '@id': `${origin}/#organization`,
    name: SEO_COMPANY.brand,
    legalName: SEO_COMPANY.name,
    url: origin,
    logo: absoluteUrl(origin, '/favicon.svg'),
    email: SEO_COMPANY.email,
    telephone: SEO_COMPANY.phone,
    vatID: SEO_COMPANY.icDph,
    taxID: SEO_COMPANY.dic,
    address: {
      '@type': 'PostalAddress',
      streetAddress: SEO_COMPANY.street,
      postalCode: SEO_COMPANY.postalCode,
      addressLocality: SEO_COMPANY.city,
      addressCountry: SEO_COMPANY.country,
    },
    contactPoint: [{ '@type': 'ContactPoint', telephone: SEO_COMPANY.phone, email: SEO_COMPANY.email, contactType: 'customer service', availableLanguage: ['sk', 'cs'] }],
  };
}

export function productJsonLd(origin: string, product: TmProduct) {
  const url = absoluteUrl(origin, product.detail_url || `/produkt/${product.slug}`);
  const image = (Array.isArray(product.images) ? product.images : [product.image]).filter(Boolean).map((v) => absoluteUrl(origin, v));
  const inStock = product.stock_status === 'instock' && Number(product.stock_quantity ?? 1) > 0;
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.name,
    description: productDescription(product),
    sku: product.sku || undefined,
    image,
    url,
    brand: { '@type': 'Brand', name: String(product.name || '').split(/\s+/)[0] || 'ToneryMaxim' },
    category: Array.isArray(product.categories) ? product.categories.map((c: any) => c.name).filter(Boolean).join(' > ') : undefined,
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'EUR',
      price: Number(product.price || 0).toFixed(2),
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': `${origin}/#organization` },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'SK' },
        shippingRate: { '@type': 'MonetaryAmount', value: '2.90', currency: 'EUR' },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 2, unitCode: 'DAY' },
        },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'SK',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 14,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/FreeReturn',
      },
    },
  };
  return data;
}

export function breadcrumbJsonLd(origin: string, items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: absoluteUrl(origin, item.path) })),
  };
}
