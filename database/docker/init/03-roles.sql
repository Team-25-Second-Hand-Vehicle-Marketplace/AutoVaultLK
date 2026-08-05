-- One login role per service. Local dev passwords only —
-- production uses AWS Secrets Manager.
--
-- Table-level grants are NOT here. They live in database/src/grants.sql
-- and run AFTER migrations, because GRANT ... ON ALL TABLES needs the
-- tables to already exist.

CREATE ROLE auth_service_role         LOGIN PASSWORD 'dev_auth';
CREATE ROLE marketplace_service_role  LOGIN PASSWORD 'dev_marketplace';
CREATE ROLE ingestion_service_role    LOGIN PASSWORD 'dev_ingestion';
CREATE ROLE notification_service_role LOGIN PASSWORD 'dev_notification';
CREATE ROLE admin_service_role        LOGIN PASSWORD 'dev_admin';

GRANT CONNECT ON DATABASE vehicle_marketplace TO
  auth_service_role,
  marketplace_service_role,
  ingestion_service_role,
  notification_service_role,
  admin_service_role;
