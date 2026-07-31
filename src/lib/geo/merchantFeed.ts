type MerchantProduct = {
  id?: string | number;
  title?: string;
  name?: string;
  price?: number | string;
  description?: string;
  image?: string;
  availability?: string;
  stock_status?: string;
  product_type_key?: string;
};

export function validateMerchantProduct(p: MerchantProduct) {
 return !!(p.id&&p.title&&p.price&&p.description&&p.image&&p.availability);
}
export function buildFeed(products: MerchantProduct[]) {
 return products.filter(validateMerchantProduct);
}
