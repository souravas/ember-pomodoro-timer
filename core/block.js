// Site blocking domain logic. Pure functions only — the service worker turns
// these into declarativeNetRequest rules; tests exercise them directly.

// How many sites a blocklist may hold. Dynamic DNR rules allow thousands,
// but a focus blocklist past this size is a curation problem, not a limit.
export const MAX_BLOCKED_SITES = 100;

// One blocklist line → a bare hostname, or null if no hostname survives.
// Accepts the ways people paste sites: full URLs, "www." prefixes, trailing
// paths, stray whitespace. "www." is stripped so the whole domain blocks.
function normalizeHost(line) {
  let host = line.trim().toLowerCase();
  if (!host || host.startsWith('#')) return null; // blank or comment line
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  host = host.replace(/[/?#].*$/, ''); // path, query, fragment
  host = host.replace(/:\d+$/, ''); // port
  host = host.replace(/^www\./, '');
  host = host.replace(/\.$/, ''); // trailing dot (FQDN form)
  // A blockable host: dot-separated labels of letters/digits/hyphens.
  // Single-label names (localhost) are refused — blocking those is a typo.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null;
  return host;
}

// The user's blocklist text (one site per line, commas tolerated) → unique
// normalized hostnames, capped at MAX_BLOCKED_SITES.
export function parseBlockList(text) {
  const hosts = [];
  for (const line of String(text ?? '').split(/[\n,]/)) {
    const host = normalizeHost(line);
    if (host && !hosts.includes(host)) hosts.push(host);
    if (hosts.length >= MAX_BLOCKED_SITES) break;
  }
  return hosts;
}

// Hostnames → declarativeNetRequest dynamic rules: each host redirects its
// page loads (subdomains included — that's requestDomains semantics) to the
// quiet blocked page, carrying the host so the page can name it.
export function buildRules(hosts, blockedPageUrl) {
  return hosts.map((host, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { url: `${blockedPageUrl}?from=${encodeURIComponent(host)}` },
    },
    condition: {
      requestDomains: [host],
      resourceTypes: ['main_frame'],
    },
  }));
}

// The blocklist host a URL falls under, or null. Matches the host itself and
// any subdomain — the same shape requestDomains enforces at the network
// layer — so the open-tab sweep and the rules can never disagree.
export function matchesHosts(url, hosts) {
  let hostname;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    hostname = u.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
  for (const host of hosts) {
    if (hostname === host || hostname.endsWith('.' + host)) return host;
  }
  return null;
}

// True when this state should have the blocklist enforced: the user opted
// in, listed something, and focused work is on the clock right now. Pausing
// lifts the block — stepping off the clock is the escape hatch.
export function blockingActive(state, workPhases) {
  return Boolean(
    state.settings.blockEnabled &&
      state.status === 'running' &&
      workPhases.includes(state.phase) &&
      parseBlockList(state.settings.blockList).length > 0
  );
}
