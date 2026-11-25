// Tier-1 trusted business, finance, news, official registry, and executive source domains
export const TIER1_TRUSTED_DOMAINS = [
  "bloomberg.com",
  "reuters.com",
  "ft.com",
  "wsj.com",
  "forbes.com",
  "techcrunch.com",
  "venturebeat.com",
  "crunchbase.com",
  "linkedin.com",
  "sec.gov",
  "companieshouse.gov.uk",
  "inc.com",
  "fastcompany.com",
  "sifted.eu",
  "zawya.com",
  "arabianbusiness.com",
  "gulfbusiness.com",
  "saudigazette.com.sa",
  "thenationalnews.com",
  "businesswire.com",
  "prnewswire.com",
  "github.com",
];

// Blocklist of low-quality scraper aggregators, spam directories, and scraper clones ($0 waste filter)
export const SCRAPER_BLOCKED_DOMAINS = [
  "zoominfo.com",
  "rocketreach.co",
  "rocketreach.com",
  "contactout.com",
  "signalhire.com",
  "lusha.com",
  "lead411.com",
  "leadiq.com",
  "upcount.io",
  "anymailfinder.com",
  "hunter.io",
  "swordfish.ai",
  "adapt.io",
  "seamless.ai",
  "yellowpages.com",
  "dnb.com",
  "manta.com",
  "bizapedia.com",
  "apollo.io", // Don't cite Apollo itself as web proof
];

/**
 * Checks if a domain or URL belongs to Tier-1 verified sources.
 */
export function isTier1TrustedSource(urlOrDomain: string): boolean {
  if (!urlOrDomain) return false;
  const clean = cleanDomain(urlOrDomain);
  return TIER1_TRUSTED_DOMAINS.some((d) => clean === d || clean.endsWith(`.${d}`));
}

/**
 * Checks if a domain is a blocked scraper aggregator.
 */
export function isScraperBlockedDomain(urlOrDomain: string): boolean {
  if (!urlOrDomain) return false;
  const clean = cleanDomain(urlOrDomain);
  return SCRAPER_BLOCKED_DOMAINS.some((d) => clean === d || clean.endsWith(`.${d}`));
}

/**
 * Normalizes any URL or domain into a bare hostname.
 */
export function cleanDomain(urlOrDomain: string): string {
  try {
    let raw = urlOrDomain.trim().toLowerCase();
    if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
      raw = `https://${raw}`;
    }
    const parsed = new URL(raw);
    let host = parsed.hostname.replace(/^www\./, "");
    return host;
  } catch {
    return urlOrDomain.trim().toLowerCase().replace(/^www\./, "").split("/")[0];
  }
}
