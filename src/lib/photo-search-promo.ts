export const PHOTO_SEARCH_PATH = '/hladat-fotkou';
export const PHOTO_GUIDE_SLUG = 'ako-najst-napln-fotoaparatom';
export const PHOTO_GUIDE_PATH = `/poradna/${PHOTO_GUIDE_SLUG}`;
export const PHOTO_GUIDE_MENU_LABEL = 'Ako nájsť náplň fotoaparátom';

export function showPhotoSearch(url: URL): boolean {
  return process.env.TM_PHOTO_SEARCH_ENABLED !== '0' || url.searchParams.get('foto') === '1';
}
