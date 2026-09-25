terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# One zip-packaged Lambda function, instantiated once per lightweight ETL
# stage handler (see docs/STEP-FUNCTIONS-MIGRATION-PLAN.md §S7 for why these
# 10 are zip and embed/process-images are container images via modules.lambda
# instead).
#
# BOOTSTRAP ORDER — same chicken-and-egg as modules.lambda's ECR repos: the S3
# object at s3_key must already exist before this resource can be created.
# First apply of a brand-new environment must create the lambda-artifacts
# bucket first (-target), build+upload the zips, then apply the rest. See
# environments/production/README.md.
#
# After that, CI updates the running function directly via `aws lambda
# update-function-code --s3-bucket ... --s3-key ...` — faster than a full
# terraform apply. Unlike modules.lambda's image_uri, s3_bucket/s3_key here
# are static values this module never recomputes, so a later `terraform
# apply` has nothing to fight and no lifecycle.ignore_changes is needed.
# -----------------------------------------------------------------------------

locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
    Service     = var.service_name
  }
}

resource "aws_lambda_function" "this" {
  function_name = "${var.project_name}-${var.service_name}-${var.environment}"
  s3_bucket     = var.s3_bucket
  s3_key        = var.s3_key
  handler       = var.handler
  runtime       = var.runtime
  role          = var.execution_role_arn

  memory_size = var.memory_size
  timeout     = var.timeout

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }

  environment {
    variables = var.environment_variables
  }

  tags = local.tags
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "function_arn" {
  value = aws_lambda_function.this.arn
}

output "invoke_arn" {
  value = aws_lambda_function.this.invoke_arn
}
