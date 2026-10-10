export const memoryDefaults = {
  enabled: false,
  timeoutMinutes: 30,
  keepRecent: 3,
  excludedHosts: [
    'docs.google.com',
    'notion.so',
    'figma.com',
    'meet.google.com',
    'teams.microsoft.com',
  ],
};

export function normalizeHosts(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  return [
    ...new Set(
      entries
        .filter((entry) => typeof entry === 'string')
        .map((entry) => {
          const raw = entry.trim().replace(/^\*\./, '');
          if (!raw) return null;
          try {
            const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
            if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
              return null;
            return url.hostname.toLowerCase().replace(/\.$/, '');
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    ),
  ].slice(0, 100);
}

export function normalizeMemory(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  return {
    enabled: value.enabled === true,
    timeoutMinutes: [5, 15, 30, 60, 120].includes(value.timeoutMinutes) ? value.timeoutMinutes : 30,
    keepRecent: [0, 2, 3, 5, 10].includes(value.keepRecent) ? value.keepRecent : 3,
    excludedHosts:
      value.excludedHosts === undefined
        ? [...memoryDefaults.excludedHosts]
        : normalizeHosts(value.excludedHosts),
  };
}

export function isProtectedHost(host, exclusions) {
  return exclusions.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function isOrdinaryTab(tab, config) {
  if (
    !Number.isInteger(tab.id) ||
    tab.id < 0 ||
    tab.active ||
    tab.highlighted ||
    tab.pinned ||
    tab.audible ||
    tab.incognito ||
    tab.discarded ||
    tab.autoDiscardable !== true ||
    tab.status !== 'complete' ||
    tab.pendingUrl ||
    tab.mutedInfo?.reason === 'capture' ||
    (Number.isInteger(tab.splitViewId) && tab.splitViewId >= 0)
  )
    return false;
  if (!Number.isFinite(tab.lastAccessed) || tab.lastAccessed <= 0) return false;
  try {
    const url = new URL(tab.url);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !isProtectedHost(url.hostname.toLowerCase().replace(/\.$/, ''), config.excludedHosts)
    );
  } catch {
    return false;
  }
}

export function isEligible(tab, config, now = Date.now()) {
  return isOrdinaryTab(tab, config) && now - tab.lastAccessed >= config.timeoutMinutes * 60000;
}

export function selectCandidates(tabs, config, now = Date.now()) {
  // Keep the most recently used ordinary tabs, even if they exceed the inactivity timer.
  const recent = new Set(
    tabs
      .filter((tab) => isOrdinaryTab(tab, config))
      .sort((a, b) => b.lastAccessed - a.lastAccessed)
      .slice(0, config.keepRecent)
      .map((tab) => tab.id),
  );
  return tabs
    .filter((tab) => !recent.has(tab.id) && isEligible(tab, config, now))
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
}
