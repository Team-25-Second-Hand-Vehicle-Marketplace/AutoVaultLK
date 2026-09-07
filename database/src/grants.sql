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


GRANT USAGE  ON SCHEMA auth           TO marketplace_service_role;
GRANT SELECT ON auth.users            TO marketplace_service_role;
GRANT SELECT ON auth.dealer_profiles  TO marketplace_service_role;

-- ingestion.upload_jobs.dealer_id -> auth.users.id
GRANT USAGE  ON SCHEMA auth TO ingestion_service_role;
GRANT SELECT ON auth.users  TO ingestion_service_role;
-- POST /ingest/upload is restricted to VERIFIED business dealers, and
-- that status lives in auth.dealer_profiles.verification_status. Read-only,
-- mirroring the identical grant marketplace_service_role holds above.
GRANT SELECT ON auth.dealer_profiles TO ingestion_service_role;

GRANT USAGE  ON SCHEMA auth TO notification_service_role;
GRANT SELECT ON auth.users  TO notification_service_role;

GRANT USAGE  ON SCHEMA ingestion       TO marketplace_service_role;
GRANT SELECT ON ingestion.upload_jobs  TO marketplace_service_role;


GRANT USAGE ON SCHEMA marketplace TO ingestion_service_role;
GRANT SELECT, INSERT, UPDATE ON marketplace.vehicles        TO ingestion_service_role;
GRANT SELECT, INSERT, UPDATE ON marketplace.vehicle_images  TO ingestion_service_role;

GRANT USAGE ON SCHEMA auth, marketplace, ingestion, notification TO admin_service_role;

GRANT SELECT ON ALL TABLES IN SCHEMA auth          TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA marketplace   TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA ingestion     TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA notification  TO admin_service_role;

GRANT SELECT ON marketplace.vehicle_dictionaries TO ingestion_service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth          GRANT SELECT ON TABLES TO admin_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace   GRANT SELECT ON TABLES TO admin_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ingestion     GRANT SELECT ON TABLES TO admin_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification  GRANT SELECT ON TABLES TO admin_service_role;


