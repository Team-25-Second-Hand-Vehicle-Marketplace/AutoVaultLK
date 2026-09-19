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

# Mirrors database/docker/init/03-roles.sql minus ingestion_service_role
# (ingestion isn't deployed). Locally those roles use fixed dev passwords;
# here Terraform generates one random password per role — see the module
# README note on applying them to the actual database.
variable "db_service_roles" {
  type        = list(string)
  description = "One Secrets Manager entry + random password per service DB role"
  default     = ["auth", "marketplace", "admin", "notification"]
}

# The only secret that isn't Terraform-generated — it's a real external API
# key from Groq, so it has to come from you. No default: pass via a
# git-ignored *.auto.tfvars or -var, never commit a real value.
variable "groq_api_key" {
  type        = string
  description = "marketplace-service's own NL-search Groq fallback (independent of ingestion's, which isn't deployed)"
  sensitive   = true
}
