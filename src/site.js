export const SITE = Object.freeze({
  name: '大肥鱼衣橱',
  owner: 'Fightingshine',
  repository: 'blue-whale-wardrobe',
  github: 'https://github.com/Fightingshine/blue-whale-wardrobe',
  maxUploadBytes: 10 * 1024 * 1024,
  maxPixels: 24_000_000,
});

export function assetUrl(relative) {
  return new URL(`${import.meta.env.BASE_URL}${relative}`, document.baseURI).href;
}
