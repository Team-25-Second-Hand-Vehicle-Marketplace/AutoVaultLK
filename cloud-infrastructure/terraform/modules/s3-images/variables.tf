variable "project_name" {
  type        = string
  description = "Resource name prefix"
  default     = "vehicle-marketplace"
}

variable "environment" {
  type        = string
  description = "Deployment stage (dev, staging, production) — part of the bucket name, so each environment gets its own bucket without any other input changing."
  default     = "dev"
}

# No default: a bucket name is derived from project_name + environment by
# default (see locals.bucket_name in main.tf), but every place that names it
# explicitly is this variable — never a literal string — so pointing the
# whole stack at a pre-existing or differently-named bucket later is a
# one-line change here, not an edit to the module.
variable "bucket_name_override" {
  type        = string
  description = "Explicit bucket name. Leave null to derive one from project_name/environment."
  default     = null
}

variable "force_destroy" {
  type        = bool
  description = "Allow `terraform destroy` to delete a non-empty bucket. Never true in production — see the production environment's own default below (main.tf's teammate variables.tf should hardcode false there, not rely on this default)."
  default     = false
}

# -----------------------------------------------------------------------------
# Access grants. Both lists take IAM role NAMES (as created by modules/iam,
# or any other role in this account) — not ARNs, so the policy document can
# scope itself to this account without the caller having to know account ids.
#
# Deliberately NOT hardcoded to ["ingestion", "marketplace"]: ingestion-
# service has no deployed Lambda role in this pass (see production/main.tf's
# note on why), so a module default naming it would silently produce an
# empty grant today and a surprise the day ingestion is finally deployed.
# The caller states explicitly, per environment, which roles need which
# access — that is what "swap the bucket or the account later by editing
# environment config, not this module" actually requires.
# -----------------------------------------------------------------------------

variable "reader_role_names" {
  type        = list(string)
  description = "IAM role names granted s3:GetObject (+ ListBucket) — typically marketplace, to generate presigned GET URLs."
  default     = []
}

variable "writer_role_names" {
  type        = list(string)
  description = "IAM role names granted s3:PutObject (+ GetObject + ListBucket) — typically ingestion, once it is deployed."
  default     = []
}

variable "cors_allowed_origins" {
  type        = list(string)
  description = "Origins allowed to GET objects directly via presigned URL (the browser, not the Lambda that signs it). Pass the frontend's CloudFront domain in production."
  default     = ["*"]
}

# A signed URL is only as short-lived as the caller asks for when signing;
# this bounds it server-side too, via a bucket lifecycle/policy backstop
# rather than trusting every caller to ask for something short. Documented
# here so it travels with the bucket, not buried in application code.
variable "max_presign_expiry_seconds" {
  type        = number
  description = "Upper bound communicated to consumers (enforced in application code, not by AWS) for how long a presigned URL may remain valid."
  default     = 900 # 15 minutes
}
