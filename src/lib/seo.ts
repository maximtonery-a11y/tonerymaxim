import { compactKey, stripHtml, type TmProduct } from './tm-products-cache';
import { cleanGtin, cleanMpn, cleanProductBrand, gtinSchemaProperty } from './product-identifiers';

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

export function websiteJsonLd(origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name: SEO_SITE_NAME,
    url: origin,
    publisher: { '@id': `${origin}/#organization` },
    inLanguage: 'sk-SK',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${origin}/produkty?s={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

function productDetailUrl(origin: string, product: TmProduct): string {
  const raw = String(product.detail_url || '').trim();
  const fallback = `/produkt/${encodeURIComponent(String(product.slug || product.id || ''))}`;

  if (!raw || raw === '#') {
    return absoluteUrl(origin, fallback);
  }

  try {
    const parsed = new URL(raw, origin);
    const pathname = parsed.pathname.replace(/^\/novy(?=\/|$)/, '') || '/';

    if (pathname.startsWith('/produkt/')) {
      return new URL(`${pathname}${parsed.search}${parsed.hash}`, origin).toString();
    }

    if (!/^https?:/i.test(raw)) {
      return new URL(`${pathname}${parsed.search}${parsed.hash}`, origin).toString();
    }
  } catch {
    // Neplatnú alebo starú URL nahradíme finálnou produktovou URL.
  }

  return absoluteUrl(origin, fallback);
}

function productBrandName(product: TmProduct): string | undefined {
  const taxonomyBrand = Array.isArray(product.brands)
    ? product.brands.find((brand: any) => brand?.name)?.name
    : '';
  const direct = product.product_brand || product.manufacturer_brand || taxonomyBrand;
  const cleanDirect = cleanProductBrand(direct);
  if (cleanDirect) return cleanDirect;

  const attributes = Array.isArray(product.attributes_all)
    ? product.attributes_all
    : Array.isArray(product.attributes)
      ? product.attributes
      : [];
  const brandAttribute = attributes.find((attribute: any) => {
    const name = compactKey(attribute?.name || attribute?.slug || '');
    return [
      'znackaproduktu',
      'vyrobcaproduktu',
      'productbrand',
      'productmanufacturer',
    ].includes(name);
  });
  const value = brandAttribute?.value
    || brandAttribute?.option
    || (Array.isArray(brandAttribute?.values) ? brandAttribute.values[0] : '')
    || (Array.isArray(brandAttribute?.options) ? brandAttribute.options[0] : '');
  return cleanProductBrand(value) || undefined;
}

export function productJsonLd(origin: string, product: TmProduct) {
  const url = productDetailUrl(origin, product);
  const image = (Array.isArray(product.images) ? product.images : [product.image]).filter(Boolean).map((v) => absoluteUrl(origin, v));
  const stockStatus = String(product.stock_status || '').toLowerCase();
  const stockQuantity = product.stock_quantity == null ? null : Number(product.stock_quantity);
  const availability = stockStatus === 'onbackorder'
    ? 'https://schema.org/BackOrder'
    : stockStatus === 'preorder'
      ? 'https://schema.org/PreOrder'
      : stockStatus === 'instock' && (stockQuantity == null || stockQuantity > 0)
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock';
  const price = Number(product.price || 0);
  const brand = productBrandName(product);
  const gtin = cleanGtin(product.gtin);
  const gtinProperty = gtinSchemaProperty(gtin);
  const mpn = cleanMpn(product.mpn);
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.name,
    description: productDescription(product),
    sku: product.sku || undefined,
    image,
    url,
    brand: brand ? { '@type': 'Brand', name: brand } : undefined,
    ...(gtinProperty ? { [gtinProperty]: gtin } : {}),
    mpn: mpn || undefined,
    category: Array.isArray(product.categories) ? product.categories.map((c: any) => c.name).filter(Boolean).join(' > ') : undefined,
    offers: price > 0 ? {
      '@type': 'Offer',
      url,
      priceCurrency: 'EUR',
      price: price.toFixed(2),
      availability,
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': `${origin}/#organization` },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'SK',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 14,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/ReturnShippingFees',
      },
    } : undefined,
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
