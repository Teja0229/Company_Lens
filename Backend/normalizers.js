/**
 * Shared data normalization and duplicate identification utilities.
 */

function extractPlaceId(url) {
  if (!url) return "";
  const match1 = String(url).match(/1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
  if (match1) return match1[1].toLowerCase();
  const match2 = String(url).match(/(ChIJ[a-zA-Z0-9_-]+)/);
  if (match2) return match2[1];
  return "";
}

function normalizeCompanyLink(url) {
  if (!url) return "";
  const placeId = extractPlaceId(url);
  if (placeId) return placeId;
  return String(url).split("?")[0].toLowerCase().replace(/\/+$/, "");
}

function normalizeCompanyName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(pvt|ltd|llc|inc|private|limited|corporation|corp|co)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function normalizeWebsite(url) {
  if (!url || url === "N/A") return "";
  try {
    const parsed = new URL(url.startsWith("http") ? url : `http://${url}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (["google.com", "facebook.com", "linkedin.com", "instagram.com", "twitter.com", "x.com"].includes(host)) {
      return "";
    }
    return host;
  } catch {
    return "";
  }
}

function normalizePhone(phone) {
  if (!phone || phone === "N/A") return "";
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-10) : "";
}

function normalizeAddress(addr) {
  return String(addr || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompanyRecord(company = {}) {
  return {
    link: normalizeCompanyLink(company.google_maps_link),
    name: normalizeCompanyName(company.company_name),
    website: normalizeWebsite(company.website),
    phone: normalizePhone(company.phone),
    address: normalizeAddress(company.address),
  };
}

function generateDuplicateKey(company = {}) {
  const norm = normalizeCompanyRecord(company);
  if (norm.link) return `link:${norm.link}`;
  if (norm.name && norm.address) return `name_addr:${norm.name}::${norm.address.slice(0, 30)}`;
  return company.id ? `id:${company.id}` : "";
}

module.exports = {
  extractPlaceId,
  normalizeCompanyLink,
  normalizeCompanyName,
  normalizeWebsite,
  normalizePhone,
  normalizeAddress,
  normalizeCompanyRecord,
  generateDuplicateKey,
};

