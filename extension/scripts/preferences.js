export const defaultLinks = [
  { label: 'YouTube', url: 'https://www.youtube.com/', icon: '▶' },
  { label: 'Gmail', url: 'https://mail.google.com/', icon: '✉' },
  { label: 'GitHub', url: 'https://github.com/', icon: '⌘' },
];
export const engines = {
  google: 'https://www.google.com/search',
  bing: 'https://www.bing.com/search',
  duckduckgo: 'https://duckduckgo.com/',
};
export const ranges = {
  brightness: [20, 100],
  blur: [0, 16],
  saturation: [0, 180],
  overlay: [0, 80],
  positionX: [0, 100],
  positionY: [0, 100],
  clockSize: [64, 180],
  glass: [0, 70],
};
export const choices = {
  scene: ['aurora', 'dusk', 'ocean', 'custom'],
  engine: Object.keys(engines),
  font: ['modern', 'serif', 'mono', 'rounded'],
  layout: ['center', 'left', 'right'],
  vertical: ['top', 'center', 'bottom'],
  fit: ['cover', 'contain'],
  speed: ['0.5', '0.75', '1', '1.25', '1.5', '2'],
  timezone: ['local', 'UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'Asia/Tokyo'],
  linkStyle: ['minimal', 'tiles'],
  searchStyle: ['soft', 'pill', 'square'],
};
export const flags = [
  'showClock',
  'showSearch',
  'showDate',
  'showGreeting',
  'showLinks',
  'showBrand',
  'hour24',
  'seconds',
  'motion',
  'newTabLinks',
];
export function defaults(reducedMotion = false) {
  return {
    scene: 'aurora',
    brightness: 75,
    blur: 0,
    saturation: 100,
    overlay: 0,
    positionX: 50,
    positionY: 50,
    fit: 'cover',
    speed: '1',
    showClock: true,
    showSearch: true,
    showDate: true,
    showGreeting: true,
    showLinks: true,
    showBrand: true,
    hour24: false,
    seconds: false,
    motion: !reducedMotion,
    engine: 'google',
    timezone: 'local',
    font: 'modern',
    clockSize: 142,
    accent: '#c8ddac',
    textColor: '#f0f3ef',
    layout: 'center',
    vertical: 'center',
    glass: 6,
    name: '',
    greeting: '',
    linkStyle: 'minimal',
    searchStyle: 'soft',
    newTabLinks: false,
    links: defaultLinks.map((link) => ({ ...link })),
  };
}
export function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
  try {
    const trimmed = value.trim();
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.hostname
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function normalize(value, reducedMotion = false) {
  const result = defaults(reducedMotion);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, list] of Object.entries(choices))
    if (list.includes(String(value[key]))) result[key] = String(value[key]);
  for (const key of flags) if (typeof value[key] === 'boolean') result[key] = value[key];
  for (const [key, [min, max]] of Object.entries(ranges))
    if (Number.isFinite(value[key])) result[key] = Math.max(min, Math.min(max, value[key]));
  for (const key of ['accent', 'textColor'])
    if (/^#[\da-f]{6}$/i.test(value[key])) result[key] = value[key];
  for (const [key, limit] of [
    ['name', 40],
    ['greeting', 160],
    ['mediaUpdated', 100],
  ])
    if (typeof value[key] === 'string') result[key] = value[key].slice(0, limit);
  if (Array.isArray(value.links))
    result.links = value.links.slice(0, 12).flatMap((link) => {
      const url = safeUrl(link?.url);
      return url && typeof link.label === 'string' && link.label.trim()
        ? [
            {
              label: link.label.trim().slice(0, 30),
              url,
              icon: typeof link.icon === 'string' ? link.icon.slice(0, 4) : '',
            },
          ]
        : [];
    });
  // Preserve the original grouped visibility settings when upgrading v1.0.
  if (!('showDate' in value) && value.showClock === false)
    result.showDate = result.showGreeting = false;
  if (!('showLinks' in value) && value.showSearch === false) result.showLinks = false;
  return result;
}
