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

variable "service_names" {
  type        = list(string)
  description = "One execution role is created per entry"
  default     = ["auth", "marketplace", "admin", "notification"]
}

variable "shared_secret_arns" {
  type        = list(string)
  description = "Secrets every service Lambda can read (JWT secret, internal service key, DB credentials)"
  default     = []
}

variable "service_extra_secret_arns" {
  type        = map(list(string))
  description = "Per-service secrets on top of the shared list, e.g. { marketplace = [groq_api_key_arn] }"
  default     = {}
}

variable "ses_send_services" {
  type        = list(string)
  description = "Services granted ses:SendEmail (only auth sends real email in this pass)"
  default     = ["auth"]
}

variable "ses_identity_arn" {
  type        = string
  description = "SES identity ARN to scope ses:SendEmail to"
  default     = null
}

variable "internal_api_invoker_services" {
  type        = list(string)
  description = "Services granted execute-api:Invoke on the internal API Gateway (admin calls notification/auth over it)"
  default     = ["admin"]
}

variable "internal_api_execution_arn" {
  type        = string
  description = "Internal HTTP API's execution ARN, e.g. module.api_gateway.internal_api_execution_arn"
  default     = null
}
