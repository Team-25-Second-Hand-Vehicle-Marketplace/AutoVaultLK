terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Lets GitHub Actions assume an AWS role via OIDC — no long-lived access keys
# stored in GitHub. Scoped to workflow_dispatch runs from this repo's main
# branch only (manual deploys, not every push — see the deploy workflow's
# `on:` block, which has no push/pull_request trigger at all).
# -----------------------------------------------------------------------------

locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

data "tls_certificate" "github" {
  count = var.create_oidc_provider ? 1 : 0
  url   = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github[0].certificates[0].sha1_fingerprint]
  tags            = local.tags
}

locals {
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : var.existing_oidc_provider_arn

  # GitHub issues one of two `sub` claim shapes depending on the repo's OIDC
  # settings (GET /repos/{repo}/actions/oidc/customization/sub):
  #   name-based:   repo:ORG/REPO:ref:refs/heads/main
  #   immutable ID: repo:ORG@ORG_ID/REPO@REPO_ID:ref:refs/heads/main
  # New repos default to the immutable form, which the name-based condition
  # silently rejects ("Not authorized to perform sts:AssumeRoleWithWebIdentity").
  # Both are exact matches for this one repo's main branch — accepting the
  # second does not widen who can assume the role.
  main_branch_subjects = concat(
    ["repo:${var.github_org}/${var.github_repo}:ref:refs/heads/main"],
    var.github_org_id != null && var.github_repo_id != null ? [
      "repo:${var.github_org}@${var.github_org_id}/${var.github_repo}@${var.github_repo_id}:ref:refs/heads/main"
    ] : [],
  )
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.main_branch_subjects
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${var.project_name}-github-deploy-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"] # this specific action has no resource-level scoping
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:BatchGetImage",
    ]
    resources = var.ecr_repository_arns
  }

  statement {
    sid       = "LambdaDeploy"
    actions   = ["lambda:UpdateFunctionCode", "lambda:GetFunction"]
    resources = concat(var.lambda_function_arns, var.zip_lambda_function_arns)
  }

  dynamic "statement" {
    for_each = var.lambda_artifact_bucket_arn != null ? [1] : []
    content {
      sid = "LambdaArtifactUpload"
      # GetObject is required too: `lambda update-function-code --s3-bucket`
      # reads the zip with the CALLER's credentials, not Lambda's, and fails
      # with "Your access has been denied by S3" without it.
      actions   = ["s3:PutObject", "s3:GetObject"]
      resources = ["${var.lambda_artifact_bucket_arn}/lambda-artifacts/*"]
    }
  }

  dynamic "statement" {
    for_each = var.lambda_artifact_bucket_arn != null ? [1] : []
    content {
      sid       = "LambdaArtifactBucketList"
      actions   = ["s3:ListBucket"]
      resources = [var.lambda_artifact_bucket_arn]
    }
  }

  statement {
    sid       = "FrontendSync"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [var.frontend_bucket_arn, "${var.frontend_bucket_arn}/*"]
  }

  statement {
    sid       = "FrontendInvalidate"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [var.frontend_distribution_arn]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

output "role_arn" {
  value = aws_iam_role.github_deploy.arn
}
