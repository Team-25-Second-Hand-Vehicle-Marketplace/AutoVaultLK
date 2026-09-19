variable "project_name" {
  type        = string
  description = "Resource name prefix"
  default     = "vehicle-marketplace"
}

variable "environment" {
  type        = string
  description = "Deployment stage (dev, staging, prod)"
  default     = "dev"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "From modules.networking.private_subnet_ids"
}

variable "db_service_role_secret_arns" {
  type        = map(string)
  description = "Map of service name -> Secrets Manager ARN holding {username, password} for that role — one RDS Proxy auth block gets created per entry, in addition to the master user's. From modules.secrets.db_service_role_arns"
  default     = {}
}

variable "security_group_id" {
  type        = string
  description = "From modules.networking.database_security_group_id"
}

variable "engine_version" {
  type        = string
  description = "Postgres version — pgvector and pg_trgm both need 15.2+ / 16.1+ / 17.x on RDS. Checked available via `aws rds describe-db-engine-versions --engine postgres` for the target region — 17.4 (SADV1's era) isn't offered in ap-southeast-2, 17.11 is the latest 17.x there as of this deploy."
  default     = "17.11"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "allocated_storage" {
  type    = number
  default = 20
}

variable "db_name" {
  type    = string
  default = "vehicle_marketplace"
}

variable "master_username" {
  type    = string
  default = "marketplace"
}

# Single-instance, no Multi-AZ, 1-day backups, no final snapshot — matches
# the rest of this deployment's "cheap first deploy" tradeoffs. Raise
# backup_retention_period and turn on multi_az before this holds real user
# data long-term.
variable "backup_retention_period" {
  type    = number
  default = 1
}
