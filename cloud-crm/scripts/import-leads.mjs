import fs from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileFlag = args.indexOf("--file");
const requestedFile = fileFlag >= 0 ? args[fileFlag + 1] : "config/leads.json";
if (!requestedFile || requestedFile.startsWith("--")) throw new Error("Use --file <path> to select a lead JSON file.");
const filePath = path.resolve(process.cwd(), requestedFile);
const configRoot = path.resolve(process.cwd(), "config");
if (!(filePath === configRoot || filePath.startsWith(`${configRoot}${path.sep}`))) {
  throw new Error("Lead imports must come from the cloud-crm/config directory.");
}

const leads = JSON.parse(await fs.readFile(filePath, "utf8"));
if (!Array.isArray(leads) || leads.length === 0) throw new Error("Lead file must contain a non-empty JSON array.");

function requireText(lead, key, index) {
  const value = lead[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Lead ${index + 1} requires ${key}.`);
  return value.trim();
}

const normalized = leads.map((lead, index) => {
  const phone = requireText(lead, "phone", index);
  if (!/^\+1\d{10}$/.test(phone)) throw new Error(`Lead ${index + 1} phone must use +1 E.164 format.`);
  const verifiedOn = requireText(lead, "verifiedOn", index);
  if (Number.isNaN(Date.parse(`${verifiedOn}T00:00:00Z`))) throw new Error(`Lead ${index + 1} verifiedOn must be YYYY-MM-DD.`);
  if (!lead.businessHours || typeof lead.businessHours !== "object" || Array.isArray(lead.businessHours)) {
    throw new Error(`Lead ${index + 1} requires verified businessHours.`);
  }
  return {
    id: requireText(lead, "id", index),
    business: requireText(lead, "business", index),
    category: requireText(lead, "category", index),
    segment: requireText(lead, "segment", index),
    city: requireText(lead, "city", index),
    address: typeof lead.address === "string" ? lead.address.trim() || null : null,
    phone,
    rating: Number.isFinite(lead.rating) ? lead.rating : null,
    reviewCount: Number.isInteger(lead.reviewCount) ? lead.reviewCount : null,
    websiteUrl: typeof lead.websiteUrl === "string" ? lead.websiteUrl.trim() || null : null,
    socialUrl: typeof lead.socialUrl === "string" ? lead.socialUrl.trim() || null : null,
    evidenceNotes: requireText(lead, "evidenceNotes", index),
    primarySourceUrl: requireText(lead, "primarySourceUrl", index),
    presenceCheckUrl: requireText(lead, "presenceCheckUrl", index),
    verifiedOn,
    confidence: typeof lead.confidence === "string" ? lead.confidence : "Low",
    leadScore: Number.isInteger(lead.leadScore) ? lead.leadScore : 0,
    priority: typeof lead.priority === "string" ? lead.priority : "Low",
    qualified: lead.qualified === true,
    businessHours: lead.businessHours,
  };
});

if (dryRun) {
  console.log(`Validated ${normalized.length} lead records. No database changes were made.`);
  process.exit(0);
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required unless --dry-run is used.");
const sql = neon(process.env.DATABASE_URL);

for (const lead of normalized) {
  await sql.query(`INSERT INTO leads(id,business,category,segment,city,address,phone,rating,review_count,
      presence_class,website_url,social_url,evidence_notes,primary_source_url,presence_check_url,
      verified_on,confidence,lead_score,priority,qualified,pipeline_stage,business_hours)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Needs review',$10,$11,$12,$13,$14,$15::date,$16,$17,$18,$19,
      CASE WHEN $19 THEN 'Qualified' ELSE 'Research' END,$20::jsonb)
    ON CONFLICT(id) DO UPDATE SET business=excluded.business,category=excluded.category,segment=excluded.segment,
      city=excluded.city,address=excluded.address,phone=excluded.phone,rating=excluded.rating,
      review_count=excluded.review_count,website_url=excluded.website_url,social_url=excluded.social_url,
      evidence_notes=excluded.evidence_notes,primary_source_url=excluded.primary_source_url,
      presence_check_url=excluded.presence_check_url,verified_on=excluded.verified_on,confidence=excluded.confidence,
      lead_score=excluded.lead_score,priority=excluded.priority,qualified=excluded.qualified,
      pipeline_stage=CASE WHEN leads.attempt_count>0 THEN leads.pipeline_stage ELSE excluded.pipeline_stage END,
      business_hours=excluded.business_hours,updated_at=now()`,
  [lead.id, lead.business, lead.category, lead.segment, lead.city, lead.address, lead.phone, lead.rating,
    lead.reviewCount, lead.websiteUrl, lead.socialUrl, lead.evidenceNotes, lead.primarySourceUrl,
    lead.presenceCheckUrl, lead.verifiedOn, lead.confidence, lead.leadScore, lead.priority,
    lead.qualified, JSON.stringify(lead.businessHours)]);
}

console.log(`Imported ${normalized.length} leads. Campaign state was not changed and no calls were placed.`);
