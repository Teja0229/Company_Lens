require("dotenv").config();
const supabaseModule = require("./supabase");
const supabase = supabaseModule.forAccessToken("admin");

const { generateDuplicateKey } = require("./normalizers");

async function cleanupDuplicates(dryRun = false) {
  console.log(`Starting duplicate cleanup (dryRun: ${dryRun})...`);
  const { data: companies, error } = await supabase.from("companies").select("*");
  if (error) {
    console.error("Error fetching companies:", error);
    return;
  }
  console.log(`Total records in DB: ${companies.length}`);

  const groups = new Map();

  for (const comp of companies) {
    const key = generateDuplicateKey(comp);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(comp);
  }

  const duplicatesToDelete = [];
  let duplicateGroupsCount = 0;

  for (const [key, group] of groups.entries()) {
    if (group.length > 1) {
      duplicateGroupsCount++;
      group.sort((a, b) => {
        const score = (row) => {
          let s = 0;
          if (row.phone && row.phone !== "N/A") s += 2;
          if (row.website && row.website !== "N/A") s += 2;
          if (row.gmail && row.gmail !== "N/A") s += 2;
          if (row.linkedin_url && row.linkedin_url !== "N/A") s += 2;
          if (row.company_type) s += 1;
          return s;
        };
        return score(b) - score(a);
      });

      const primary = group[0];
      const redundancies = group.slice(1);
      console.log(`Group [${key}] Primary: "${primary.company_name}" (${primary.id}). Removing ${redundancies.length} redundant copies.`);
      for (const r of redundancies) {
        duplicatesToDelete.push(r.id);
      }
    }
  }

  console.log(`Found ${duplicateGroupsCount} duplicate groups with a total of ${duplicatesToDelete.length} redundant rows.`);

  if (dryRun || duplicatesToDelete.length === 0) {
    console.log("Dry-run complete. No rows modified.");
    return duplicatesToDelete.length;
  }

  const batchSize = 50;
  for (let i = 0; i < duplicatesToDelete.length; i += batchSize) {
    const batch = duplicatesToDelete.slice(i, i + batchSize);
    const { error: delError } = await supabase.from("companies").delete().in("id", batch);
    if (delError) {
      console.error("Error deleting batch:", delError);
    } else {
      console.log(`Deleted batch of ${batch.length} duplicates.`);
    }
  }

  console.log("Cleanup finished successfully.");
}

const isDryRun = process.argv.includes("--dry-run");
cleanupDuplicates(isDryRun);
