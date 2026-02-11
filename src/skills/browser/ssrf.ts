import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

// Helper to check if a range is private/unsafe
function isPrivateRange(range: string): boolean {
  return [
    'private',
    'loopback',
    'linkLocal',
    'uniqueLocal',
    'reserved',
    'broadcast',
    'multicast',
    'carrierGradeNat',
    'unspecified'
  ].includes(range);
}

/**
 * Checks if an IP address is private or reserved.
 * @param ip The IP address string.
 * @returns True if private/reserved, false otherwise.
 */
export function isPrivateIP(ip: string): boolean {
  try {
    const addr = ipaddr.parse(ip);
    const range = addr.range();

    // Check for IPv4-mapped IPv6 addresses (::ffff:127.0.0.1)
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
      const ipv4 = (addr as ipaddr.IPv6).toIPv4Address();
      const ipv4Range = ipv4.range();
      return isPrivateRange(ipv4Range);
    }

    return isPrivateRange(range);
  } catch (e) {
    // If parsing fails, it's not a valid IP, so it's not a private IP *in that sense*,
    // but the caller (validateUrl) handles hostname vs IP.
    return false;
  }
}

/**
 * Validates a URL by resolving its hostname and checking all IPs.
 * @param url The URL to validate.
 * @throws Error if the URL resolves to a private IP.
 */
export async function validateUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  let hostname = parsed.hostname;

  // Remove brackets from IPv6 literals (e.g., [::1] -> ::1)
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

  // dns.lookup handles both names and IPs.
  // We use `all: true` to check all addresses.
  try {
    const addresses = await dns.lookup(hostname, { all: true });

    if (!addresses || addresses.length === 0) {
       throw new Error(`No DNS records found for ${hostname}`);
    }

    for (const { address } of addresses) {
      if (isPrivateIP(address)) {
        throw new Error(`Access to private IP ${address} is forbidden.`);
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('forbidden')) {
      throw e;
    }
    // Propagate DNS errors
    throw new Error(`DNS resolution failed for ${hostname}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * A safe fetch wrapper that prevents SSRF.
 * Handles redirects manually to validate each hop.
 */
export async function safeFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const maxRedirects = 5;
  let currentUrl = url;
  let response: Response | undefined;

  // Clone options to avoid mutating the original object
  const fetchOptions = { ...options, redirect: 'manual' as RequestRedirect };

  for (let i = 0; i < maxRedirects; i++) {
    // Validate the URL before fetching
    await validateUrl(currentUrl);

    response = await fetch(currentUrl, fetchOptions);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        // Redirect without location? Return the response as is.
        return response;
      }

      // Resolve relative URLs
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
         throw new Error(`Invalid redirect location: ${location}`);
      }
      continue;
    }

    return response;
  }

  throw new Error(`Too many redirects (max ${maxRedirects})`);
}
