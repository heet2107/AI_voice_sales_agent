import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Connect Neon and pull the Vercel environment first.");
}

const sql = neon(process.env.DATABASE_URL);

const migration = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE IF NOT EXISTS leads (
    id text PRIMARY KEY,
    business text NOT NULL,
    category text NOT NULL,
    segment text NOT NULL DEFAULT 'local_business',
    city text NOT NULL,
    address text,
    phone text NOT NULL,
    rating numeric(3,2),
    review_count integer,
    rating_source text,
    presence_class text NOT NULL DEFAULT 'Needs review',
    website_url text,
    social_url text,
    evidence_notes text,
    primary_source_url text,
    presence_check_url text,
    verified_on date,
    confidence text NOT NULL DEFAULT 'Medium',
    lead_score integer NOT NULL DEFAULT 0,
    priority text NOT NULL DEFAULT 'Medium',
    qualified boolean NOT NULL DEFAULT false,
    pipeline_stage text NOT NULL DEFAULT 'New',
    do_not_call boolean NOT NULL DEFAULT false,
    dnc_reason text,
    attempt_count integer NOT NULL DEFAULT 0,
    last_contact_at timestamptz,
    next_follow_up_at timestamptz,
    owner text NOT NULL DEFAULT 'AI calling agent',
    outcome text,
    objection text,
    call_notes text,
    recheck_due date,
    business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
    research_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
    research_status text NOT NULL DEFAULT 'needs_review',
    research_profile_updated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS campaign_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_date date NOT NULL,
    status text NOT NULL DEFAULT 'scheduled',
    target_count integer NOT NULL DEFAULT 15,
    attempted_count integer NOT NULL DEFAULT 0,
    connected_count integer NOT NULL DEFAULT 0,
    meeting_count integer NOT NULL DEFAULT 0,
    notes text,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(run_date)
  );

  CREATE TABLE IF NOT EXISTS daily_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid REFERENCES campaign_runs(id) ON DELETE CASCADE,
    queue_date date NOT NULL,
    slot_label text NOT NULL,
    slot_at timestamptz,
    sequence integer NOT NULL,
    lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'scheduled',
    outcome text,
    next_step text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(queue_date, sequence),
    UNIQUE(queue_date, lead_id)
  );

  CREATE TABLE IF NOT EXISTS calls (
    id text PRIMARY KEY,
    lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    queue_id uuid REFERENCES daily_queue(id) ON DELETE SET NULL,
    lifecycle text NOT NULL DEFAULT 'queued',
    network_outcome text,
    task_success text,
    outcome_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    talk_seconds integer NOT NULL DEFAULT 0,
    task text,
    transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
    recording_url text,
    recording_available_until timestamptz,
    recording_expired boolean NOT NULL DEFAULT false,
    transcript_captured_at timestamptz,
    summary text,
    summary_generated_at timestamptz,
    ai_analysis jsonb,
    analysis_status text NOT NULL DEFAULT 'pending',
    started_at timestamptz NOT NULL DEFAULT now(),
    finalized_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS follow_ups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    call_id text REFERENCES calls(id) ON DELETE SET NULL,
    type text NOT NULL,
    channel text,
    contact text,
    status text NOT NULL DEFAULT 'open',
    due_at timestamptz,
    draft text,
    notes text,
    approval_status text NOT NULL DEFAULT 'draft',
    approved_at timestamptz,
    sent_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS dnc_entries (
    phone text PRIMARY KEY,
    lead_id text REFERENCES leads(id) ON DELETE SET NULL,
    call_id text REFERENCES calls(id) ON DELETE SET NULL,
    reason text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS script_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'proposed',
    content text NOT NULL,
    change_summary text,
    evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
    fixed_guardrails jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    activated_at timestamptz
  );

  CREATE TABLE IF NOT EXISTS script_experiments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    baseline_script_id uuid NOT NULL REFERENCES script_versions(id),
    variant_script_id uuid NOT NULL REFERENCES script_versions(id),
    status text NOT NULL DEFAULT 'running',
    target_human_calls integer NOT NULL DEFAULT 5,
    human_calls integer NOT NULL DEFAULT 0,
    success_metric text NOT NULL DEFAULT 'workflow_question_answered',
    rollback_condition text NOT NULL,
    result jsonb NOT NULL DEFAULT '{}'::jsonb,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS meeting_briefs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    call_id text REFERENCES calls(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'draft',
    meeting_at timestamptz,
    format text,
    contact_name text,
    brief jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(call_id)
  );

  CREATE TABLE IF NOT EXISTS analysis_calibrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id text NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    reviewer text NOT NULL DEFAULT 'Human reviewer',
    status text NOT NULL DEFAULT 'pending',
    manual_scorecard jsonb NOT NULL DEFAULT '{}'::jsonb,
    agreement jsonb NOT NULL DEFAULT '{}'::jsonb,
    notes text,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(call_id)
  );

  CREATE TABLE IF NOT EXISTS icp_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    segment text NOT NULL,
    match_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
    decision_maker_role text NOT NULL,
    discovery_question text NOT NULL,
    likely_objection text NOT NULL,
    safe_response text NOT NULL,
    service_hypothesis text NOT NULL DEFAULT 'none',
    privacy_notes text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS ai_usage (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id text REFERENCES calls(id) ON DELETE SET NULL,
    feature text NOT NULL,
    model text,
    input_tokens integer,
    output_tokens integer,
    status text NOT NULL,
    error text,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id bigserial PRIMARY KEY,
    entity_type text NOT NULL,
    entity_id text,
    action text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    identity_hash text PRIMARY KEY,
    failure_count integer NOT NULL DEFAULT 0,
    window_started_at timestamptz NOT NULL DEFAULT now(),
    blocked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_leads_pipeline_stage ON leads(pipeline_stage);
  CREATE INDEX IF NOT EXISTS idx_leads_next_follow_up ON leads(next_follow_up_at);
  CREATE INDEX IF NOT EXISTS idx_calls_lead_id ON calls(lead_id);
  CREATE INDEX IF NOT EXISTS idx_calls_lifecycle ON calls(lifecycle);
  CREATE INDEX IF NOT EXISTS idx_queue_date_status ON daily_queue(queue_date, status);
  CREATE INDEX IF NOT EXISTS idx_followups_status_due ON follow_ups(status, due_at);
  CREATE INDEX IF NOT EXISTS idx_experiments_status ON script_experiments(status, started_at);
  CREATE INDEX IF NOT EXISTS idx_calibrations_status ON analysis_calibrations(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_meeting_briefs_lead ON meeting_briefs(lead_id, created_at);

  ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_available_until timestamptz;
  ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_expired boolean NOT NULL DEFAULT false;
  ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcript_captured_at timestamptz;
  ALTER TABLE calls ADD COLUMN IF NOT EXISTS summary_generated_at timestamptz;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS research_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS research_status text NOT NULL DEFAULT 'needs_review';
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS research_profile_updated_at timestamptz;
  ALTER TABLE leads ADD COLUMN IF NOT EXISTS research_depth text NOT NULL DEFAULT 'standard';
  ALTER TABLE calls ADD COLUMN IF NOT EXISTS script_version_id uuid REFERENCES script_versions(id);
  ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft';
  ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS approved_at timestamptz;
  ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS sent_at timestamptz;

  UPDATE calls c SET script_version_id=s.id
  FROM script_versions s
  WHERE c.script_version_id IS NULL AND c.task LIKE ('%Use campaign script ' || s.version || ':%');
  UPDATE follow_ups SET approval_status='approved',approved_at=COALESCE(approved_at,created_at)
  WHERE status='completed' OR type='retry_call';

  INSERT INTO icp_profiles(slug,name,segment,match_terms,decision_maker_role,discovery_question,likely_objection,safe_response,service_hypothesis,privacy_notes)
  VALUES
    ('restaurants-hospitality','Restaurants, cafés and hospitality','local_business','["restaurant","cafe","coffee","bakery","bar","tavern","dessert"]'::jsonb,'Owner or general manager','When the front-of-house team is busy, how are reservation, catering, or customer inquiries handled?','We already handle inquiries ourselves.','That makes sense. What normally happens when the team is serving guests or after hours?','website_chat_agent','Do not request customer payment or reservation details.'),
    ('salons-spas','Salons, barbers and spas','local_business','["salon","barber","spa"]'::jsonb,'Owner or salon or spa manager','When everyone is helping a client, how are new appointment calls or website questions handled?','Our booking system already works.','Understood. Are there any questions or calls that still arrive outside that booking flow?','website_chat_agent','Do not request client medical, treatment or payment information.'),
    ('clinics-practices','Clinics and appointment practices','service_smb','["dental","dentist","orthodont","clinic","veterinary","medical","optometr","chiropr","therapy"]'::jsonb,'Practice owner, practice manager, or office manager','When the front desk is tied up, how are new appointment inquiries handled?','Our front desk handles that.','That makes sense. What happens when they are already on another call or the office is closed?','voice_calling_agent','Never request patient information or claim regulatory compliance.'),
    ('home-auto-services','Home, field and automotive services','service_smb','["hvac","plumb","electric","roof","pest","clean","landscap","auto","repair","contractor"]'::jsonb,'Owner, operations manager, or service manager','When the team is helping customers or out on jobs, how are missed estimate, service, or appointment calls handled?','We just call people back.','That can work. How quickly are callbacks usually made when the team is busy?','voice_calling_agent','Do not request payment, vehicle-identification, or customer account information.'),
    ('real-estate-property','Real estate and property management','service_smb','["property","real estate"]'::jsonb,'Broker-owner, managing broker, or operations manager','How are after-hours rental, showing, maintenance, or new-client inquiries routed today?','We already use a property-management system.','Understood. Which inquiries still arrive by phone or website outside that system?','custom_ai_automation','Do not request tenant, financial, property-access, or qualification data.'),
    ('insurance','Independent insurance agencies','service_smb','["insurance"]'::jsonb,'Agency owner, principal, or office manager','When the office is busy, how are new quote and policy-service inquiries routed?','Our carrier systems already handle that.','Understood. Which initial questions or routing steps still reach your staff directly?','custom_ai_automation','Do not request policy, claim, identity, medical, payment, or financial information.')
  ON CONFLICT(slug) DO NOTHING;

  INSERT INTO settings(key,value) VALUES('same_day_retry','true'::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now();
  INSERT INTO settings(key,value) VALUES('same_day_retry_min_gap_minutes','80'::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now();
  INSERT INTO settings(key,value) VALUES('same_day_retry_max_per_lead','1'::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now();
`;

const statements = migration.split(/;\s*(?:\n|$)/).map((statement) => statement.trim()).filter(Boolean);
for (const statement of statements) await sql.query(statement);

console.log("Database migration completed.");
