terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# One ECR repo + one image-package-type Lambda function, instantiated once
# per deployed service (auth, marketplace, admin, notification).
#
# BOOTSTRAP ORDER — image-based Lambdas cannot be created against an empty
# ECR repo. First apply of a brand-new environment must:
#   1. terraform apply -target=module.<service>_lambda.aws_ecr_repository.this
#      for all 4 services (creates the repos, nothing else)
#   2. build + push each service's Docker image to its new repo at :latest
#      (or whatever var.image_tag is)
#   3. terraform apply (no -target) to create the actual functions
#
# After that, CI/CD updates the running image via `aws lambda
# update-function-code --image-uri ...` (faster than a full terraform apply)
# — hence `lifecycle.ignore_changes = [image_uri]` below, so a later
# `terraform apply` doesn't fight CI and roll the image back to var.image_tag.
# Terraform still owns everything else about the function (memory, timeout,
# VPC config, env vars, role).
# -----------------------------------------------------------------------------

locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
    Service     = var.service_name
  }
}

resource "aws_ecr_repository" "this" {
  name = "${var.project_name}/${var.service_name}-${var.environment}"

  image_scanning_configuration {
    scan_on_push = true
  }

  force_delete = true

  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_lambda_function" "this" {
  function_name = "${var.project_name}-${var.service_name}-${var.environment}"
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.this.repository_url}:${var.image_tag}"
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

  lifecycle {
    ignore_changes = [image_uri]
  }
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "function_arn" {
  value = aws_lambda_function.this.arn
}

output "invoke_arn" {
  description = "For an apigatewayv2_integration's integration_uri"
  value       = aws_lambda_function.this.invoke_arn
}

output "ecr_repository_arn" {
  value = aws_ecr_repository.this.arn
}

output "ecr_repository_url" {
  value = aws_ecr_repository.this.repository_url
}
