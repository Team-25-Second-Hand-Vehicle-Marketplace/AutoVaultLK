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

# No default: a bucket name is derived from project_name/environment unless
# this is set. S3 bucket names are globally unique across every AWS account,
# not just this one - two accounts running this same stack need different
# names, so this is a one-line change per environment, not an edit here.
variable "bucket_name_override" {
  type        = string
  description = "Explicit bucket name. Leave null to derive one from project_name/environment."
  default     = null
}

# CloudFront cost tier - PriceClass_100 (US/Canada/Europe edges only) is the
# cheapest; widen if buyers outside those regions need lower latency.
variable "price_class" {
  type    = string
  default = "PriceClass_100"
}
