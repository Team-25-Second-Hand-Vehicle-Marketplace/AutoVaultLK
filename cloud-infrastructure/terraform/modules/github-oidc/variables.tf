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

# Numeric IDs, needed when the repo issues immutable-ID subject claims (see
# main_branch_subjects in main.tf). Get them with:
#   gh api repos/<org>/<repo> --jq '.owner.id, .id'
# Leave both null to trust only the name-based subject.
variable "github_org_id" {
  type    = string
  default = null
}

variable "github_repo_id" {
  type    = string
  default = null
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
  description = "Container-image-packaged Lambda function ARNs (deployed via ECR push + UpdateFunctionCode --image-uri)"
}

variable "zip_lambda_function_arns" {
  type        = list(string)
  description = "Zip-packaged Lambda function ARNs (deployed via S3 upload + UpdateFunctionCode --s3-bucket/--s3-key) — same UpdateFunctionCode/GetFunction grant as lambda_function_arns, just a separate list since they come from a different pipeline"
  default     = []
}

variable "lambda_artifact_bucket_arn" {
  type        = string
  description = "The lambda-artifacts S3 bucket CI uploads zip_lambda_function_arns' packages to before updating each function. Null skips the grant (e.g. an environment with no zip-packaged Lambdas)."
  default     = null
}

variable "frontend_bucket_arn" {
  type = string
}

variable "frontend_distribution_arn" {
  type = string
}
