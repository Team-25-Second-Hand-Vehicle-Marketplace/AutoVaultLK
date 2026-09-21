terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Private object store for vehicle images (NFR-19: "Vehicle images shall not
# be publicly writable; access shall be via signed URLs"). No CloudFront, no
# public bucket policy, no ACLs — every read a browser makes is a presigned
# GET URL marketplace-service mints per request and that expires shortly
# after.
#
# This is a separate module from modules/s3 (frontend hosting) on purpose:
# that one is a CloudFront+OAC static site, a materially different shape from
# "private object store two backend services read/write via IAM, never the
# public internet directly." Merging them would mean every consumer of one
# also has to understand the other's unrelated inputs.
# -----------------------------------------------------------------------------

locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }

  bucket_name = coalesce(var.bucket_name_override, "${var.project_name}-images-${var.environment}")
}

resource "aws_s3_bucket" "images" {
  bucket        = local.bucket_name
  force_destroy = var.force_destroy
  tags          = local.tags
}

resource "aws_s3_bucket_public_access_block" "images" {
  bucket = aws_s3_bucket.images.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "images" {
  bucket = aws_s3_bucket.images.id
  versioning_configuration {
    # Off, not "Suspended": a bulk re-upload replacing every image for a
    # vehicle should not silently retain every prior version at storage
    # cost with no code anywhere reading them back.
    status = "Disabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "images" {
  bucket = aws_s3_bucket.images.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CORS governs the browser's direct GET against the presigned URL — not the
# Lambda-to-S3 call that mints it, which never leaves AWS's network.
resource "aws_s3_bucket_cors_configuration" "images" {
  bucket = aws_s3_bucket.images.id

  cors_rule {
    allowed_methods = ["GET"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

# Three key prefixes share this bucket (see ingestion-service's
# image-processing.stage.ts and envelope.ts):
#   raw/{jobId}/...           the dealer's original upload — FR-28.1 requires
#                              this never be altered or overwritten, so it is
#                              kept indefinitely (no rule below touches it).
#   images/{jobId}/{vehicleId}/...  the processed photo + thumbnail a listing
#                              actually serves — also kept indefinitely; this
#                              is the one a stray expiry rule would notice
#                              first, as a vehicle whose photos silently
#                              404 months after upload.
#   staging/{jobId}/...        the pipeline's own inter-stage scratch JSON —
#                              nothing reads it once the job has finished, and
#                              envelope.ts already documents the 7-day expiry
#                              this rule implements.
resource "aws_s3_bucket_lifecycle_configuration" "images" {
  bucket = aws_s3_bucket.images.id

  rule {
    id     = "expire-staging-scratch"
    status = "Enabled"
    filter {
      prefix = "staging/"
    }
    expiration {
      days = 7
    }
  }
}

# ---- Reader access (presigned GET) -----------------------------------------

data "aws_iam_policy_document" "read" {
  count = length(var.reader_role_names) > 0 ? 1 : 0

  statement {
    sid       = "GetImages"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.images.arn}/*"]
  }

  statement {
    sid       = "ListImagesBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.images.arn]
  }
}

resource "aws_iam_role_policy" "read" {
  for_each = toset(var.reader_role_names)

  name   = "s3-images-read"
  role   = each.value
  policy = data.aws_iam_policy_document.read[0].json
}

# ---- Writer access (ETL upload) --------------------------------------------

data "aws_iam_policy_document" "write" {
  count = length(var.writer_role_names) > 0 ? 1 : 0

  statement {
    sid       = "PutAndGetImages"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.images.arn}/*"]
  }

  statement {
    sid       = "ListImagesBucketForWriters"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.images.arn]
  }

  # No s3:DeleteObject: ADR-002's "ETL must not be able to destroy a
  # dealer's manually created listings" applies here as much as it does to
  # marketplace.vehicles — the ETL role writes and overwrites, never
  # deletes.
}

resource "aws_iam_role_policy" "write" {
  for_each = toset(var.writer_role_names)

  name   = "s3-images-write"
  role   = each.value
  policy = data.aws_iam_policy_document.write[0].json
}

output "bucket_name" {
  value = aws_s3_bucket.images.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.images.arn
}

output "bucket_regional_domain_name" {
  value = aws_s3_bucket.images.bucket_regional_domain_name
}
