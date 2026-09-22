// SSRF protection for monitor requests. Only public http(s) addresses may be fetched:
// URLs are validated up front, and every DNS answer is re-checked at connect time
// (safeLookup), which also covers redirects and DNS rebinding.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

const blocked = new BlockList();
// IPv4: "this" network, private, CGNAT, loopback, link-local (incl. cloud metadata),
// IETF/test ranges, benchmarking, multicast, reserved, broadcast.
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
// IPv6: unspecified, loopback, NAT64, discard, documentation, unique local,
// link-local, multicast. IPv4-mapped addresses (::ffff:a.b.c.d) are matched
// against the IPv4 rules above by BlockList itself; don't add ::ffff:0:0/96
// here, as BlockList would then block every IPv4 address.
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

/** True for anything that isn't a public unicast IP address. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

function isInternalHostname(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    !host.includes(".")
  );
}

/** Parses and validates a monitor URL. Throws UnsafeUrlError with a readable reason. */
export function validateTargetUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https URLs can be monitored");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs containing credentials are not allowed");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UnsafeUrlError(`Port ${url.port} is not allowed`);
  }
  // URL normalizes IPv4 shorthand (e.g. http://2130706433) and brackets IPv6 hosts.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new UnsafeUrlError("Private or reserved IP addresses are not allowed");
  } else if (isInternalHostname(host)) {
    throw new UnsafeUrlError("Internal hostnames are not allowed");
  }
  return url;
}

/**
 * Drop-in replacement for dns.lookup used by the HTTP client. Rejects the
 * connection if any resolved address is private/reserved.
 */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, "");
    if (addresses.length === 0) return callback(new UnsafeUrlError(`${hostname} did not resolve`), "");
    if (addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(new UnsafeUrlError(`${hostname} resolves to a private or reserved address`), "");
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};
