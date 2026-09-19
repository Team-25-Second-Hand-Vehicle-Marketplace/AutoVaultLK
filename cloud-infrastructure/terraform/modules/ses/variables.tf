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

# Simplest path: verify one sender address (e.g. no-reply@yourdomain.com)
# without owning the domain in Route53. Works for a first deploy.
variable "sender_email" {
  type        = string
  description = "Single email address verified as a sending identity"
  default     = null
}

# Fuller path: verify the whole domain (any address @domain can send,
# better deliverability via DKIM). Only used if set.
variable "domain_name" {
  type        = string
  description = "Domain to verify for sending, e.g. autovaultlk.com — leave null to use sender_email instead"
  default     = null
}

# If the domain above is on Route53 in this account, pass its zone id and
# the verification + DKIM records are created automatically. Otherwise
# they're just outputs for you to add at your registrar/DNS provider.
variable "route53_zone_id" {
  type    = string
  default = null
}
