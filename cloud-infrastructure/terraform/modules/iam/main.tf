terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# One least-privilege execution role per deployed service Lambda. Every role
# gets CloudWatch logging + VPC ENI management (all 4 Lambdas sit in the VPC
# for RDS access) and read access to the shared secrets; extra permissions
# (SES send, internal API invoke) are opt-in per service via the variables
# below rather than granted to all four.
# -----------------------------------------------------------------------------

locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }

  ses_send_set        = toset([for s in var.service_names : s if contains(var.ses_send_services, s)])
  internal_invoke_set = toset([for s in var.service_names : s if contains(var.internal_api_invoker_services, s)])
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  for_each           = toset(var.service_names)
  name               = "${var.project_name}-${each.key}-lambda-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  for_each   = aws_iam_role.lambda
  role       = each.value.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "vpc_access" {
  for_each   = aws_iam_role.lambda
  role       = each.value.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "secrets_access" {
  for_each = aws_iam_role.lambda

  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = concat(var.shared_secret_arns, lookup(var.service_extra_secret_arns, each.key, []))
  }
}

resource "aws_iam_role_policy" "secrets_access" {
  for_each = aws_iam_role.lambda
  name     = "secrets-access"
  role     = each.value.id
  policy   = data.aws_iam_policy_document.secrets_access[each.key].json
}

data "aws_iam_policy_document" "ses_send" {
  statement {
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = var.ses_identity_arn != null ? [var.ses_identity_arn] : ["*"]
  }
}

resource "aws_iam_role_policy" "ses_send" {
  for_each = local.ses_send_set
  name     = "ses-send"
  role     = aws_iam_role.lambda[each.key].id
  policy   = data.aws_iam_policy_document.ses_send.json
}

data "aws_iam_policy_document" "internal_api_invoke" {
  statement {
    actions   = ["execute-api:Invoke"]
    resources = var.internal_api_execution_arn != null ? ["${var.internal_api_execution_arn}/*"] : ["*"]
  }
}

resource "aws_iam_role_policy" "internal_api_invoke" {
  for_each = local.internal_invoke_set
  name     = "internal-api-invoke"
  role     = aws_iam_role.lambda[each.key].id
  policy   = data.aws_iam_policy_document.internal_api_invoke.json
}

output "role_arns" {
  description = "Map of service name -> execution role ARN"
  value       = { for k, v in aws_iam_role.lambda : k => v.arn }
}
