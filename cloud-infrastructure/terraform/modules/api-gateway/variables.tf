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

variable "aws_region" {
  type        = string
  description = "AWS region for API Gateway"
  default     = "ap-southeast-1"
}

variable "cors_allow_origins" {
  type        = list(string)
  description = "Optional override for browser origins; defaults to api-gateway/config/cors.json allowOrigins"
  default     = null
}

# Map route prefix -> Lambda invoke ARN, e.g.
# { auth = auth_invoke_arn, users = auth_invoke_arn, "dealer-profiles" = auth_invoke_arn,
#   marketplace = marketplace_invoke_arn, admin = admin_invoke_arn }
# Multiple prefixes may point at the same Lambda (auth owns 3 prefixes).
variable "public_lambda_integrations" {
  type        = map(string)
  description = "North-south HTTP API route integrations, keyed by route prefix"
  default     = {}
}

# Same shape, for the internal (east-west) API — e.g.
# { notifications = notification_invoke_arn, internal = auth_invoke_arn }
variable "internal_lambda_integrations" {
  type        = map(string)
  description = "East-west HTTP API route integrations, keyed by route prefix"
  default     = {}
}
