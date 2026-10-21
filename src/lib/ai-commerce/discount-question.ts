import { hasExplicitCartAddCommand } from '../ai-cart-safety.ts';
import { isProductPriceQuestion } from './price-question.ts';

/** A discount question pointing to an item, rather than general coupon help. */
export function isProductDiscountQuestion(message: string): boolean {
  const n = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!/\b(?:zlav\w*|zliav\w*)\b/.test(n) || hasExplicitCartAddCommand(message) || isProductPriceQuestion(message)) return false;
  return /\b(?:tento|tomto|tohto|tuto|tejto|tieto|tychto|uveden\w*)\b/.test(n)
    || /\b(?:sku|kod\s+produktu)\s*[:#-]?\s*[a-z0-9_-]+\b/.test(n)
    || /\b(?:cf|ce|crg|tn|dr|wt|mc|w|q|clt|mlt|tk|pg|cl|gi|pgi|pfi|cli|lc)[- ]?\d{2,}[a-z0-9-]*\b/.test(n)
    || /\b(?:hp|canon|epson|brother|lexmark|kyocera|xerox|samsung|oki|ricoh)\s+\d{2,4}[a-z]{0,3}\b/.test(n);
}
