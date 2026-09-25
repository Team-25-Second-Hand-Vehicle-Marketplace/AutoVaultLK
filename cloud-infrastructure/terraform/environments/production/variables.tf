variable "aws_region" {
  type    = string
  default = "ap-southeast-2"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "project_name" {
  type    = string
  default = "vehicle-marketplace"
}

# The only value you MUST supply — see cloud-infrastructure/terraform/environments/production/README.md.
# Pass via a git-ignored production.auto.tfvars, never commit a real key.
variable "groq_api_key" {
  type      = string
  sensitive = true
}

# --- SES sending identity — set at least one of these two ---
variable "ses_sender_email" {
  type    = string
  default = null
}

variable "ses_domain_name" {
  type    = string
  default = null
}

variable "ses_route53_zone_id" {
  type    = string
  default = null
}

# Tag pushed to each ECR repo that the Lambda functions run. CI updates the
# running function directly after a build (see modules/lambda's bootstrap
# note) — this var only matters for the very first apply, before any image
# exists.
variable "image_tag" {
  type    = string
  default = "latest"
}

# Flip to false only once auth-user-service's SES integration (plan item 2)
# is actually implemented and deployed — until then this is the only way a
# registered user can complete email verification at all.
variable "auth_return_verification_token" {
  type    = bool
  default = true
}

variable "github_org" {
  type    = string
  default = "Team-25-Second-Hand-Vehicle-Marketplace"
}

variable "github_repo" {
  type    = string
  default = "AutoVaultLK"
}

# This repo issues immutable-ID OIDC subject claims, so the deploy role's trust
# policy needs its numeric IDs too: gh api repos/<org>/<repo> --jq '.owner.id, .id'
variable "github_org_id" {
  type    = string
  default = "301171207"
}

variable "github_repo_id" {
  type    = string
  default = "1329507255"
}

# Set false only if this AWS account already has a GitHub OIDC provider from
# another project — AWS allows just one per unique provider URL per account.
variable "create_github_oidc_provider" {
  type    = bool
  default = true
}

# Optional — the alerts SNS topic (module.monitoring) is created either way;
# this just subscribes an inbox to it at apply time. Subscribe later from the
# console instead if you'd rather not put an email in tfvars.
variable "alarm_email" {
  type    = string
  default = null
}

# --- SMTP email (alternative to SES) ---------------------------------------
# When smtp_host is set, auth-user-service and notification-service send mail
# over SMTP instead of SES — no SES sandbox exit or verified domain needed.
# For Gmail: smtp.gmail.com / 587 / the account's address / an APP PASSWORD
# (Google Account -> Security -> 2-Step Verification -> App passwords), never
# the normal account password. Set these in the git-ignored *.auto.tfvars.
variable "smtp_host" {
  type    = string
  default = ""
}

variable "smtp_port" {
  type    = string
  default = "587"
}

variable "smtp_user" {
  type    = string
  default = ""
}

variable "smtp_password" {
  type      = string
  default   = ""
  sensitive = true
}

# Optional display From address; defaults to the SES sender, then smtp_user.
variable "smtp_from" {
  type    = string
  default = ""
}
