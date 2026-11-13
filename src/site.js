const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

function normalizeApiUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/u, '');
}

export const SITE = Object.freeze({
  name: '大肥鱼衣橱',
  owner: 'Fightingshine',
  repository: 'blue-whale-wardrobe',
  github: 'https://github.com/Fightingshine/blue-whale-wardrobe',
  maxUploadBytes: 10 * 1024 * 1024,
  maxPixels: 24_000_000,
  submitApiUrl: normalizeApiUrl(env.VITE_SUBMIT_API_URL),
  turnstileSiteKey: String(env.VITE_TURNSTILE_SITE_KEY || '').trim(),
});

export function getDirectSubmitConfig() {
  if (typeof window !== 'undefined') {
    const host = window.location?.hostname;
    const testOverride = (host === '127.0.0.1' || host === 'localhost') ? window.__WARDROBE_TEST_CONFIG__ : null;
    if (testOverride && typeof testOverride === 'object') {
      return {
        submitApiUrl: normalizeApiUrl(testOverride.submitApiUrl ?? SITE.submitApiUrl),
        turnstileSiteKey: String(testOverride.turnstileSiteKey ?? SITE.turnstileSiteKey).trim(),
      };
    }
  }
  return {
    submitApiUrl: SITE.submitApiUrl,
    turnstileSiteKey: SITE.turnstileSiteKey,
  };
}

export function isDirectSubmitEnabled(config = getDirectSubmitConfig()) {
  return Boolean(config?.submitApiUrl && config?.turnstileSiteKey);
}

export function assetUrl(relative) {
  return new URL(`${import.meta.env.BASE_URL}${relative}`, document.baseURI).href;
}
