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
  description = "Browser origins allowed through the public API"
  default     = ["http://localhost:5173"]
}

# Map route key -> Lambda invoke ARN (fill when service Lambdas are deployed)
variable "public_lambda_integrations" {
  type        = map(string)
  description = "HTTP API route integrations for north-south traffic"
  default     = {}
}
