const { createClient } = require("@supabase/supabase-js");

function readEnvValue(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is missing. Add it to Backend/.env.`);
  }

  return value.replace(/^["']/, "").replace(/["'];?$/, "");
}

const supabaseUrl = readEnvValue("SUPABASE_URL");
const supabaseKey = readEnvValue("SUPABASE_KEY");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^['"]/, "").replace(/["'];?$/, "") || null;

if (!/^https?:\/\//i.test(supabaseUrl)) {
  throw new Error(
    "SUPABASE_URL must be a valid URL, for example https://your-project-ref.supabase.co.",
  );
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // The browser receives the OAuth session in the redirect URL fragment and
    // stores it through frontend/api.js. The server must not retain it.
    flowType: "implicit",
    persistSession: false,
    autoRefreshToken: false,
  },
});

module.exports = supabase;
module.exports.forAccessToken = (accessToken) => createClient(supabaseUrl, serviceRoleKey || supabaseKey, {
  ...(serviceRoleKey ? {} : { global: { headers: { Authorization: `Bearer ${accessToken}` } } }),
  auth: { persistSession: false, autoRefreshToken: false },
});
