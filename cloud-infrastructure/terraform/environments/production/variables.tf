variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
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
