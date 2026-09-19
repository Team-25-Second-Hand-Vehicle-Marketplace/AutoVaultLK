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

variable "github_org" {
  type        = string
  description = "GitHub org/user that owns the repo, e.g. Team-25-Second-Hand-Vehicle-Marketplace"
}

variable "github_repo" {
  type        = string
  description = "Repo name only, e.g. AutoVaultLK"
}

# AWS allows only one OIDC provider per unique URL per account. If this
# account already has one for token.actions.githubusercontent.com (common if
# any other repo/project already set up GitHub Actions OIDC here), set this
# to false and pass its ARN via existing_oidc_provider_arn instead.
variable "create_oidc_provider" {
  type    = bool
  default = true
}

variable "existing_oidc_provider_arn" {
  type    = string
  default = null
}

variable "ecr_repository_arns" {
  type        = list(string)
  description = "The 4 service ECR repo ARNs — from each modules.lambda instance's output"
}

variable "lambda_function_arns" {
  type        = list(string)
  description = "The 4 service Lambda function ARNs"
}

variable "frontend_bucket_arn" {
  type = string
}

variable "frontend_distribution_arn" {
  type = string
}
