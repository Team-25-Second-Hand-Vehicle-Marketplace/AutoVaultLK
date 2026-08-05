-- ═════════════════════════════════════════════════════════════════════════
-- Plan B — reads may cross schemas where an FK justifies it.
-- Writes never cross, except the one documented ETL exception.
--
-- Run AFTER migrations. GRANT ... ON ALL TABLES only affects tables that
-- already exist, which is why this can't live in docker/init/.
--
-- Re-run after any migration that adds a table another service reads.
-- (ALTER DEFAULT PRIVILEGES covers the owning service automatically, but
-- not cross-schema SELECT grants on new tables.)
-- ═════════════════════════════════════════════════════════════════════════


-- ═══ Own schema: full CRUD ═══════════════════════════════════════════════

GRANT USAGE ON SCHEMA auth TO auth_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO auth_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_service_role;

GRANT USAGE ON SCHEMA marketplace TO marketplace_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA marketplace TO marketplace_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO marketplace_service_role;

GRANT USAGE ON SCHEMA ingestion TO ingestion_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ingestion TO ingestion_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ingestion
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ingestion_service_role;

GRANT USAGE ON SCHEMA notification TO notification_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notification TO notification_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO notification_service_role;

GRANT USAGE ON SCHEMA admin TO admin_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA admin TO admin_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA admin
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO admin_service_role;


-- ═══ Cross-schema READS — each justified by an existing foreign key ═══════
-- Rule (plan-b §3.1): a cross-schema SELECT is allowed ONLY if an FK
-- already links the two tables. No FK means the relationship isn't
-- modelled and the read should be an API call.

-- marketplace.vehicles.dealer_id -> auth.users.id
GRANT USAGE  ON SCHEMA auth           TO marketplace_service_role;
GRANT SELECT ON auth.users            TO marketplace_service_role;
GRANT SELECT ON auth.dealer_profiles  TO marketplace_service_role;

-- ingestion.upload_jobs.dealer_id -> auth.users.id
GRANT USAGE  ON SCHEMA auth TO ingestion_service_role;
GRANT SELECT ON auth.users  TO ingestion_service_role;

-- notification.notifications.user_id -> auth.users.id
GRANT USAGE  ON SCHEMA auth TO notification_service_role;
GRANT SELECT ON auth.users  TO notification_service_role;

-- marketplace.vehicles.upload_job_id -> ingestion.upload_jobs.id
-- (dealer review dashboard shows upload status alongside listings)
GRANT USAGE  ON SCHEMA ingestion       TO marketplace_service_role;
GRANT SELECT ON ingestion.upload_jobs  TO marketplace_service_role;


-- ═══ DOCUMENTED EXCEPTION — the only cross-schema write in this plan ══════
--
-- ingestion-service's loadFn writes marketplace.vehicles and
-- marketplace.vehicle_images directly during the ETL bulk load, bypassing
-- REST.
--
-- Why: loadFn inserts ~100 rows/chunk under Step Functions
-- MaxConcurrency: 10. That limit exists specifically to bound the
-- connection pool this write holds — loadFn is the only stage in the
-- 11-Lambda chain that opens a live DB connection. Routing it through HTTP
-- moves the pressure onto marketplace-service's pool (shared with live
-- buyer search traffic) and invalidates the sizing argument without
-- replacing it.
--
-- Scope: SELECT + INSERT + UPDATE only. NEVER DELETE — ingestion adds and
-- corrects listings; removal is marketplace's decision alone.
--
-- UPDATE is required, not optional: re-running a failed upload job, or a
-- dealer CSV correcting an existing registration_number, needs it.

GRANT USAGE ON SCHEMA marketplace TO ingestion_service_role;
GRANT SELECT, INSERT, UPDATE ON marketplace.vehicles        TO ingestion_service_role;
GRANT SELECT, INSERT, UPDATE ON marketplace.vehicle_images  TO ingestion_service_role;


-- ═══ Reference data — Option B (plan-b §9) ═══════════════════════════════
--
-- makes / models / aliases are owned solely by marketplace-service and
-- live in its schema. ingestion-service gets READ-ONLY access and caches a
-- snapshot in memory at container init rather than querying per row —
-- matching what the ETL design already specifies for groqNormalizeFn's
-- make/model resolution.
--
-- Alias promotion from ingestion goes through marketplace's API, NOT a
-- direct write. That is what keeps this platform to ONE cross-schema write
-- exception instead of two.
--
-- Note these are SELECT-only and must NOT inherit the INSERT/UPDATE from
-- the ETL exception above — that exception names its two tables explicitly
-- for exactly this reason.

GRANT SELECT ON marketplace.makes    TO ingestion_service_role;
GRANT SELECT ON marketplace.models   TO ingestion_service_role;
GRANT SELECT ON marketplace.aliases  TO ingestion_service_role;


-- ═══ admin-service: read-only across everything ══════════════════════════
--
-- Dashboards and reports are inherently cross-cutting — counts of users,
-- listings, upload jobs, and delivery rates, often in one view. Rebuilding
-- every aggregate as a REST fan-out across five services is
-- disproportionate for an internal, trusted, read-only consumer.
--
-- STRICTLY READ-ONLY. Every admin *mutation* (approving a listing,
-- verifying a dealer, deactivating a user) goes through the owning
-- service's API. No UPDATE/INSERT/DELETE is granted below.

GRANT USAGE ON SCHEMA auth, marketplace, ingestion, notification TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA auth          TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA marketplace   TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA ingestion     TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA notification  TO admin_service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth          GRANT SELECT ON TABLES TO admin_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace   GRANT SELECT ON TABLES TO admin_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ingestion     GRANT SELECT ON TABLES TO admin_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification  GRANT SELECT ON TABLES TO admin_service_role;


-- ═════════════════════════════════════════════════════════════════════════
-- NO other cross-schema INSERT / UPDATE / DELETE exists in this file.
-- Any write grant added below this line violates Plan B and needs the same
-- weight of justification the ETL exception required (§3.1).
-- ═════════════════════════════════════════════════════════════════════════
