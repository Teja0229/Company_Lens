const express = require("express");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { spawn } = require("child_process");
require("dotenv").config();

const supabase = require("./supabase");
const {
  extractPlaceId,
  normalizeCompanyRecord,
} = require("./normalizers");

const app = express();
const scrapeJobs = new Map();

// Allow the static frontend to be previewed from a local development server
// while keeping the API on its configured Express port.
// Allow local development and the deployed Vercel frontend
app.use((req, res, next) => {
  const origin = req.headers.origin || "";

  if (
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
    origin === "https://companymaps.vercel.app"
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  }

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

async function requireCredentials(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!token) {
    return res.status(401).json({ error: "Authentication is required." });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }

  req.accessToken = token;
  req.user = data.user;
  next();
}

app.post("/api/auth/signup", async (req, res) => {
  const { email, password, fullName } = req.body;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ data });
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  let result;
  try {
    result = await supabase.auth.signInWithPassword({ email, password });
  } catch {
    return res.status(503).json({ error: "Sign-in is temporarily unavailable. Please try again." });
  }
  const { data, error } = result;

  if (error) {
    return res.status(401).json({ error: error.message });
  }

  res.json({ data });
});

const OAUTH_PROVIDERS = {
  google: "google",
  github: "github",
  facebook: "facebook",
  linkedin: "linkedin_oidc",
};

async function handleOAuthLogin(rawProvider, req, res) {
  const providerKey = String(rawProvider || "").toLowerCase();
  const provider = OAUTH_PROVIDERS[providerKey];

  if (!provider) {
    return res.status(400).json({ error: "This sign-in provider is not available." });
  }

  const redirectTo = `${req.protocol}://${req.get("host")}/login.html`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });

  const readableName = providerKey.charAt(0).toUpperCase() + providerKey.slice(1);
  if (error || !data?.url) {
    return res.status(400).json({
      error: error?.message || `${readableName} sign-in is not available right now.`,
    });
  }

  // Preflight check to verify if the provider is enabled in Supabase
  try {
    const probe = await fetch(data.url, { redirect: "manual" });
    if (!probe.ok && probe.status === 400) {
      const probeJson = await probe.json().catch(() => null);
      if (probeJson?.msg?.includes("Unsupported provider") || probeJson?.error_code === "validation_failed") {
        return res.status(400).json({
          error: `${readableName} sign-in is not enabled in your Supabase project yet. Please configure the ${readableName} OAuth provider in your Supabase Dashboard.`,
        });
      }
    }
  } catch (probeErr) {
    console.warn("OAuth preflight check failed:", probeErr.message);
  }

  res.json({ data: { url: data.url } });
}

// Preserve the original Google endpoint for deployed pages and running servers.
app.post("/api/auth/google", (req, res) => handleOAuthLogin("google", req, res));
app.post("/api/auth/oauth/:provider", (req, res) => handleOAuthLogin(req.params.provider, req, res));

app.get("/api/auth/me", requireCredentials, async (req, res) => {
  const { data, error } = await supabase.auth.getUser(req.accessToken);

  if (error) {
    return res.status(401).json({ error: error.message });
  }

  res.json({ data });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { email } = req.body;
  const redirectTo = `${req.protocol}://${req.get("host")}/reset.html`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(204).end();
});

async function updateSupabaseUser(accessToken, body) {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: process.env.SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { ok: response.ok, payload };
}

app.post("/api/auth/update-password", requireCredentials, async (req, res) => {
  const { password } = req.body;
  const { ok, payload } = await updateSupabaseUser(req.accessToken, { password });
  if (!ok) {
    return res.status(400).json({ error: payload.message || "Unable to update password." });
  }
  res.json({ data: payload });
});

app.post("/api/auth/update-profile", requireCredentials, async (req, res) => {
  const fullName = String(req.body.fullName || "").trim();
  if (!fullName || fullName.length > 80) {
    return res.status(400).json({ error: "Enter a name between 1 and 80 characters." });
  }

  const { ok, payload } = await updateSupabaseUser(req.accessToken, { data: { full_name: fullName } });
  if (!ok) {
    return res.status(400).json({ error: payload.message || "Unable to update profile." });
  }
  res.json({ data: payload });
});

// The login page only needs broad, non-sensitive totals. Keep this separate
// from the authenticated company-data API so no individual company record is
// returned before a user signs in.
let publicCompanyStatsCache = { value: null, expiresAt: 0 };

app.get("/api/company-stats", async (req, res) => {
  if (publicCompanyStatsCache.value && Date.now() < publicCompanyStatsCache.expiresAt) {
    return res.json({ data: publicCompanyStatsCache.value });
  }

  const pageSize = 1000;
  const companyTypes = new Set();
  const locations = new Set();
  let total = 0;

  try {
    for (let offset = 0; ; offset += pageSize) {
      let result = await supabase
        .from("companies")
        .select("company_type, address")
        .range(offset, offset + pageSize - 1);

      // Older CompanyLens databases do not yet have company_type. Their
      // company and location totals are still useful, but we must not invent
      // an industry total in that case.
      if (result.error?.code === "42703") {
        result = await supabase
          .from("companies")
          .select("address")
          .range(offset, offset + pageSize - 1);
      }
      const { data, error } = result;

      if (error) throw error;
      const companies = data || [];
      total += companies.length;
      companies.forEach((company) => {
        const companyType = String(company.company_type || "").trim();
        const address = String(company.address || "").trim().toLowerCase();
        if (companyType) companyTypes.add(companyType.toLowerCase());
        if (address) locations.add(address);
      });
      if (companies.length < pageSize) break;
    }

    const stats = {
      companies: total,
      industries: companyTypes.size || null,
      locations: locations.size,
    };
    publicCompanyStatsCache = { value: stats, expiresAt: Date.now() + 10 * 60 * 1000 };
    res.json({ data: stats });
  } catch (error) {
    res.status(503).json({ error: "Company statistics are temporarily unavailable." });
  }
});

app.get("/api/companies", requireCredentials, async (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const requestedOffset = Number.parseInt(req.query.offset, 10);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 1000)
    : 25;
  const offset = Number.isInteger(requestedOffset)
    ? Math.max(requestedOffset, 0)
    : 0;

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .range(offset, offset + limit - 1);

  if (error) {
    return res.status(500).json({
      error: error.message,
    });
  }

  res.json({ data });
});

app.post("/api/companies", requireCredentials, async (req, res) => {
  const {
    company_name,
    address,
    phone,
    gmail,
    website,
    google_maps_link,
    linkedin_url,
    rating,
    company_type,
  } = req.body;

  if (!address?.trim()) {
    return res
      .status(400)
      .json({ error: "Company location is required." });
  }

  const database = supabase.forAccessToken(req.accessToken);
  const isDupe = await isCompanyDuplicate(database, {
    company_name,
    address,
    phone,
    website,
    google_maps_link,
  });

  if (isDupe) {
    return res.status(409).json({ error: "This company already exists in the directory." });
  }

  const { data, error } = await database
    .from("companies")
    .insert({
      company_name: company_name?.trim() || "Unnamed company",
      address: address.trim(),
      phone: phone?.trim() || null,
      gmail: gmail?.trim() || null,
      website: website?.trim() || null,
      google_maps_link: google_maps_link?.trim() || null,
      linkedin_url: linkedin_url?.trim() || null,
      rating: rating ? Number(rating) : null,
      company_type: company_type?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({ data });
});

async function getCompanyRelatedData(companyId) {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const [employeesResult, hiringResult] = await Promise.all([
    supabase.from("company_employees").select("*").eq("company_id", companyId).order("name"),
    supabase.from("company_hiring_updates").select("*").eq("company_id", companyId).gte("posted_at", threeDaysAgo).order("posted_at", { ascending: false }),
  ]);
  return {
    employees: employeesResult.data || [],
    hiringUpdates: hiringResult.data || [],
    employeesError: employeesResult.error,
  };
}

app.get("/api/companies/:id", requireCredentials, async (req, res) => {
  const { data: company, error } = await supabase.from("companies").select("*").eq("id", req.params.id).single();
  if (error || !company) return res.status(404).json({ error: "Company not found." });
  const { employees, hiringUpdates, employeesError } = await getCompanyRelatedData(req.params.id);
  if (employeesError) {
    return res.status(500).json({ error: "Employee storage is not configured in Supabase yet. Run Backend/supabase-company-details.sql." });
  }
  res.json({ data: { company, employees, hiringUpdates } });
});

// Supports older scraped records that were saved before the companies table had an id column.
// Google Maps links are unique per listing and let those records open a profile as well.
app.get("/api/company-profile", requireCredentials, async (req, res) => {
  const googleMapsLink = String(req.query.google_maps_link || "").trim();
  if (!googleMapsLink) {
    return res.status(400).json({ error: "A Google Maps link is required." });
  }
  const { data: company, error } = await supabase
    .from("companies")
    .select("*")
    .eq("google_maps_link", googleMapsLink)
    .maybeSingle();
  if (error || !company) {
    return res.status(404).json({ error: "Company not found." });
  }

  const companyId = company.id || company.company_id;
  if (!companyId) return res.json({ data: { company, employees: [], hiringUpdates: [] } });

  const { employees, hiringUpdates } = await getCompanyRelatedData(companyId);
  res.json({ data: { company, employees, hiringUpdates } });
});

app.post("/api/companies/:id/employees", requireCredentials, async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Employee name is required." });
  const { data, error } = await supabase.from("company_employees").insert({
    company_id: req.params.id,
    name,
    role: String(req.body.role || "").trim() || null,
    linkedin_url: String(req.body.linkedin_url || "").trim() || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ data });
});

function addCompanyToMemoryCache(memoryCache, company) {
  if (!memoryCache) return;
  const { link, website, phone, name, address } = normalizeCompanyRecord(company);
  if (link) memoryCache.links.add(link);
  if (website) memoryCache.websites.add(website);
  if (phone) memoryCache.phones.add(phone);
  if (name && address) memoryCache.nameAddrs.add(`${name}::${address.slice(0, 30)}`);
}

async function isCompanyDuplicate(database, company, memoryCache = null) {
  const { link: normLink, name: normName, website: normWeb, phone: normPhone, address: normAddr } = normalizeCompanyRecord(company);

  if (memoryCache) {
    if (normLink && memoryCache.links.has(normLink)) return true;
    if (normWeb && memoryCache.websites.has(normWeb)) return true;
    if (normPhone && memoryCache.phones.has(normPhone)) return true;
    if (normName && normAddr && memoryCache.nameAddrs.has(`${normName}::${normAddr.slice(0, 30)}`)) return true;
  }

  // 1. Check Google Maps link / Place ID
  if (company.google_maps_link) {
    const cleanLink = company.google_maps_link.split("?")[0].replace(/\/+$/, "");
    const { data: linkMatches, error: linkErr } = await database
      .from("companies")
      .select("id, google_maps_link")
      .ilike("google_maps_link", `%${cleanLink}%`)
      .limit(2);
    if (!linkErr && linkMatches && linkMatches.length > 0) return true;

    const placeId = extractPlaceId(company.google_maps_link);
    if (placeId) {
      const { data: cidMatches, error: cidErr } = await database
        .from("companies")
        .select("id")
        .ilike("google_maps_link", `%${placeId}%`)
        .limit(1);
      if (!cidErr && cidMatches && cidMatches.length > 0) return true;
    }
  }

  // 2. Check website domain if non-generic
  if (normWeb) {
    const { data: webMatches, error: webErr } = await database
      .from("companies")
      .select("id")
      .ilike("website", `%${normWeb}%`)
      .limit(1);
    if (!webErr && webMatches && webMatches.length > 0) return true;
  }

  // 3. Check phone number (last 8 digits)
  if (normPhone && normPhone.length >= 8) {
    const { data: phoneMatches, error: phoneErr } = await database
      .from("companies")
      .select("id")
      .ilike("phone", `%${normPhone.slice(-8)}%`)
      .limit(1);
    if (!phoneErr && phoneMatches && phoneMatches.length > 0) return true;
  }

  // 4. Check company name & address overlap
  if (company.company_name?.trim()) {
    const { data: nameMatches, error: nameErr } = await database
      .from("companies")
      .select("id, company_name, address")
      .ilike("company_name", company.company_name.trim())
      .limit(10);
    if (!nameErr && nameMatches && nameMatches.length > 0) {
      for (const m of nameMatches) {
        if (!normAddr || !m.address) return true;
        // Check token overlap in address (city, area, state)
        const stopWords = new Set(["floor", "near", "opp", "opposite", "beside", "behind", "road", "street", "cross", "phase", "block", "plot", "building", "tower", "towers", "level", "suite"]);
        const tokens1 = normAddr.split(/\s+/).filter((w) => w.length >= 4 && !stopWords.has(w));
        const tokens2 = new Set(String(m.address).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !stopWords.has(w)));
        const overlap = tokens1.some((t) => tokens2.has(t));
        if (overlap) return true;
      }
    }
  }

  return false;
}

function broadcastJobEvent(job, event, data) {
  if (!job.sseClients) return;
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of job.sseClients) {
    try {
      client.write(message);
    } catch {
      job.sseClients.delete(client);
    }
  }
}

function publicScrapeJob(job, sinceIndex = 0) {
  const since = Math.max(0, Number.parseInt(sinceIndex, 10) || 0);
  const newCompanies = job.newCompanies || [];
  return {
    id: job.id,
    status: job.status,
    found: job.found,
    added: job.added,
    skipped: job.skipped,
    currentActivity: job.currentActivity || "",
    recentCompanies: newCompanies.slice(since),
    totalNewCompanies: newCompanies.length,
    error: job.error || null,
  };
}

async function saveScrapedCompany(job, company) {
  const database = job.database || supabase;

  // Handle fast-skipped records from scraper pre-filter
  if (company.status === "skipped") {
    job.found += 1;
    job.skipped += 1;
    const name = company.company_name || "Existing business";
    job.currentActivity = `Skipped "${name}" (already in database)`;
    broadcastJobEvent(job, "company_skipped", {
      company_name: name,
      reason: company.reason || "Already in database",
      job: publicScrapeJob(job),
    });
    return;
  }

  job.found += 1;
  if (!company.company_name || company.company_name === "N/A" || !company.address || company.address === "N/A") {
    job.skipped += 1;
    job.currentActivity = `Skipped listing without valid business name or address`;
    broadcastJobEvent(job, "company_skipped", {
      company_name: company.company_name || "Unknown",
      reason: "Incomplete listing",
      job: publicScrapeJob(job),
    });
    return;
  }

  // Check comprehensive duplicate logic
  const isDupe = await isCompanyDuplicate(database, company, job.memoryCache);
  if (isDupe) {
    job.skipped += 1;
    job.currentActivity = `Skipped "${company.company_name}" (already in database)`;
    broadcastJobEvent(job, "company_skipped", {
      company_name: company.company_name,
      reason: "Already in database",
      job: publicScrapeJob(job),
    });
    return;
  }

  const { data: savedCompany, error } = await database.from("companies").insert({
    company_name: company.company_name,
    address: company.address,
    phone: company.phone === "N/A" ? null : company.phone,
    gmail: company.email === "N/A" ? null : company.email,
    website: company.website === "N/A" ? null : company.website,
    google_maps_link: company.google_maps_link || null,
    rating: Number.isFinite(Number(company.rating)) ? Number(company.rating) : null,
    company_type: company.company_type || null,
    linkedin_url: company.linkedin_url === "N/A" ? null : company.linkedin_url,
  }).select("*").single();

  if (error) throw error;

  // Track in memory cache to avoid any immediate duplicates within this job
  addCompanyToMemoryCache(job.memoryCache, company);

  const employees = Array.isArray(company.employees) ? company.employees.filter((employee) => employee.name && employee.name !== "N/A") : [];
  if (employees.length) {
    const { error: employeesError } = await database.from("company_employees").insert(
      employees.map((employee) => ({
        company_id: savedCompany.id,
        name: employee.name,
        role: employee.role === "N/A" ? null : employee.role,
        linkedin_url: employee.linkedin_url || null,
      })),
    );
    if (employeesError) console.warn("Employees insert error:", employeesError.message);
  }

  const fullRecord = {
    ...savedCompany,
    employees,
  };

  job.added += 1;
  job.newCompanies.push(fullRecord);
  const websiteName = company.website && company.website !== "N/A" ? company.website : "Google Maps";
  job.currentActivity = `Scraped "${company.company_name}" website (${websiteName}), added to dashboard. Now scraping next website...`;

  broadcastJobEvent(job, "company_added", {
    company: fullRecord,
    job: publicScrapeJob(job),
  });
}

app.get("/api/companies/search", requireCredentials, async (req, res) => {
  const query = String(req.query.q || req.query.query || req.query.name || "").trim();
  if (!query) {
    return res.json({ data: [] });
  }

  const database = supabase.forAccessToken(req.accessToken);
  const { data, error } = await database
    .from("companies")
    .select("*")
    .ilike("company_name", `%${query}%`)
    .limit(50);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ data: data || [] });
});

app.post("/api/scrapes", requireCredentials, async (req, res) => {
  const country = String(req.body.country || "").trim();
  const city = String(req.body.city || "").trim();
  const rating = String(req.body.rating || req.body.minRating || "").trim();
  const companyType = String(req.body.companyType || "").trim();
  const companyName = String(req.body.companyName || "").trim();

  if (!companyName && (!country || !city)) {
    return res.status(400).json({ error: "Please enter a company name or country and city to search." });
  }

  // Prevent multiple concurrent scrape jobs that could conflict
  const existingActiveJob = [...scrapeJobs.values()].find((j) => j.status === "running" || j.status === "queued");
  if (existingActiveJob) {
    return res.status(409).json({
      error: "A scrape is already in progress. You can monitor its live progress in the dashboard.",
      data: publicScrapeJob(existingActiveJob),
    });
  }

  const database = supabase.forAccessToken(req.accessToken);
  const job = {
    id: randomUUID(),
    status: "queued",
    found: 0,
    added: 0,
    skipped: 0,
    error: "",
    currentActivity: "Preparing search and scrape...",
    newCompanies: [],
    sseClients: new Set(),
    memoryCache: {
      links: new Set(),
      websites: new Set(),
      phones: new Set(),
      nameAddrs: new Set(),
    },
    writeQueue: Promise.resolve(),
    database,
  };

  const script = path.join(__dirname, "google_maps_scraper.py");
  if (!fs.existsSync(script)) {
    return res.status(503).json({
      error: "Google Maps scraping is not configured because Backend/google_maps_scraper.py is missing.",
    });
  }

  scrapeJobs.set(job.id, job);

  // Pre-fetch existing database entries so the scraper can skip duplicates immediately
  let tempFilePath = "";
  try {
    const { data: existingRows } = await database
      .from("companies")
      .select("company_name, google_maps_link, address");
    if (existingRows && existingRows.length) {
      tempFilePath = path.join(__dirname, `temp-existing-${job.id}.json`);
      fs.writeFileSync(tempFilePath, JSON.stringify(existingRows));
    }
  } catch (err) {
    console.warn("Could not pre-fetch existing records for scraper:", err.message);
  }

  function runScraperViaProcess() {
    const python = process.env.SCRAPER_PYTHON || "python";
    const args = [script];
    if (country) args.push("--country", country);
    if (city) args.push("--city", city);
    if (rating) args.push("--rating", rating);
    if (companyName) args.push("--company-name", companyName);
    if (companyType) args.push("--company-type", companyType);
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      args.push("--existing-file", tempFilePath);
    }

    const child = spawn(python, args, { windowsHide: true });
    let stderr = "";
    let buffer = "";
    job.status = "running";
    const searchTarget = companyName ? `"${companyName}"` : `${companyType || "companies"}`;
    const locationTarget = city || country ? ` in ${[city, country].filter(Boolean).join(", ")}` : "";
    job.currentActivity = `Searching for ${searchTarget}${locationTarget}...`;
    broadcastJobEvent(job, "progress", { job: publicScrapeJob(job) });

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const company = JSON.parse(line);
          if (companyType && !company.company_type) company.company_type = companyType;
          job.writeQueue = job.writeQueue.then(() => saveScrapedCompany(job, company));
        } catch (error) {
          job.error = `Could not read scraper output: ${error.message}`;
        }
      }
    });

    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });

    child.on("error", (error) => {
      job.status = "failed";
      job.error = error.code === "EPERM"
        ? "Windows blocked Node.js from launching the Python scraper (spawn EPERM). Run the backend from a normal PowerShell window and allow node.exe/python.exe in your security software."
        : `Unable to start the scraper: ${error.message}. Set SCRAPER_PYTHON in Backend/.env to your Python executable.`;
      job.currentActivity = `Scrape failed: ${job.error}`;
      broadcastJobEvent(job, "completed", { job: publicScrapeJob(job) });
      try {
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch {}
    });

    child.on("close", async (code) => {
      try {
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch {}

      try {
        await job.writeQueue;
        if (job.status === "failed") return;
        job.status = code === 0 ? "completed" : "failed";
        if (code !== 0) job.error = stderr || `The scraper stopped with exit code ${code}.`;
        job.currentActivity = job.status === "completed"
          ? `Scrape complete. Added ${job.added} new companies, skipped ${job.skipped} existing records.`
          : `Scrape stopped: ${job.error}`;
        broadcastJobEvent(job, "completed", { job: publicScrapeJob(job) });
      } catch (error) {
        job.status = "failed";
        job.error = error.message;
        job.currentActivity = `Scrape failed: ${error.message}`;
        broadcastJobEvent(job, "completed", { job: publicScrapeJob(job) });
      } finally {
        for (const client of job.sseClients) {
          try { client.end(); } catch {}
        }
        job.sseClients.clear();
      }
    });
  }

  const scraperServiceUrl = process.env.SCRAPER_SERVICE_URL;
  if (scraperServiceUrl) {
    (async () => {
      try {
        job.status = "running";
        job.currentActivity = `Connecting to scraper service...`;
        broadcastJobEvent(job, "progress", { job: publicScrapeJob(job) });
        const response = await fetch(scraperServiceUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ country, city, rating, companyType, companyName }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Scraper service returned HTTP ${response.status}.`);
        for (const company of payload.data || []) {
          if (companyType && !company.company_type) company.company_type = companyType;
          job.writeQueue = job.writeQueue.then(() => saveScrapedCompany(job, company));
        }
        await job.writeQueue;
        job.status = "completed";
        job.currentActivity = `Scrape complete. Added ${job.added}, skipped ${job.skipped}.`;
        broadcastJobEvent(job, "completed", { job: publicScrapeJob(job) });
      } catch (error) {
        console.warn(`Scraper service at ${scraperServiceUrl} failed (${error.message}). Falling back to local Python process.`);
        runScraperViaProcess();
      }
    })();
    return res.status(202).json({ data: publicScrapeJob(job) });
  }

  runScraperViaProcess();
  res.status(202).json({ data: publicScrapeJob(job) });
});

app.get("/api/scrapes/:id", requireCredentials, (req, res) => {
  const job = scrapeJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "This scraping job is no longer available." });
  res.json({ data: publicScrapeJob(job, req.query.since) });
});

app.get("/api/scrapes/:id/events", requireCredentials, (req, res) => {
  const job = scrapeJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "This scraping job is no longer available." });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  job.sseClients.add(res);

  // Send initial state
  res.write(`event: progress\ndata: ${JSON.stringify({ job: publicScrapeJob(job) })}\n\n`);

  req.on("close", () => {
    job.sseClients.delete(res);
  });
});

app.post("/api/feedback", requireCredentials, async (req, res) => {
  const { type, message } = req.body;

  if (!type?.trim() || !message?.trim()) {
    return res.status(400).json({ error: "Feedback type and message are required." });
  }

  const { data, error } = await supabase
    .from("feedback")
    .insert({
      feedback_type: type.trim(),
      message: message.trim(),
      user_id: req.user.id,
    })
    .select()
    .single();

  if (error) {
    const errorMessage = error.code === "PGRST205"
      ? "Feedback storage is not configured in Supabase yet."
      : error.message;
    return res.status(500).json({ error: errorMessage });
  }

  res.status(201).json({ data });
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "login.html"));
});

// Return machine-readable errors to the frontend instead of Express's default
// HTML error page, which lets the dashboard show the real failure message.
app.use((error, req, res, next) => {
  console.error("Unhandled API error:", error);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({ error: error.message || "Unexpected backend error." });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
