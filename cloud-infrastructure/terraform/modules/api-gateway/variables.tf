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

# Map route key -> Lambda invoke ARN (unused while module is scaffold-only)
variable "public_lambda_integrations" {
  type        = map(string)
  description = "HTTP API route integrations for north-south traffic (not wired until scaffold is completed)"
  default     = {}
}
