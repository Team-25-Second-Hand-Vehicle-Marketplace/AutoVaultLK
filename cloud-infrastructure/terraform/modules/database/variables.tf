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

variable "security_group_id" {
  type        = string
  description = "From modules.networking.database_security_group_id"
}

variable "engine_version" {
  type        = string
  description = "Postgres version — pgvector and pg_trgm both need 15.2+ / 16.1+ / 17.x on RDS"
  default     = "17.4"
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
