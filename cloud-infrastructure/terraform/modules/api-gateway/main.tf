terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# SCAFFOLD ONLY — routes and integrations are NOT provisioned yet.
#
# This module creates HTTP APIs and stages (public + internal) plus public CORS.
# It does NOT create aws_apigatewayv2_route or aws_apigatewayv2_integration
# resources, so terraform apply will NOT route traffic in AWS.
#
# Invoke URLs exist but return API Gateway 404 until integrations are wired.
# Local development uses api-gateway/local/nginx.conf (port 8080) instead.
# OpenAPI specs under api-gateway/openapi/ are the route catalogue for a later
# import / integration pass (see commented example below).
# -----------------------------------------------------------------------------

locals {
  # Single source of truth: api-gateway/config/cors.json (synced to nginx + OpenAPI via npm run sync:cors)
  cors = jsondecode(file("${path.module}/../../../../api-gateway/config/cors.json"))
  cors_allow_origins = coalesce(var.cors_allow_origins, local.cors.allowOrigins)
}

# Public north-south API (SAD section 3.5.1)
resource "aws_apigatewayv2_api" "public" {
  name          = "${var.project_name}-public-${var.environment}"
  protocol_type = "HTTP"
  description   = "AutoVault LK public API Gateway"

  cors_configuration {
    allow_origins     = local.cors_allow_origins
    allow_methods     = local.cors.allowMethods
    allow_headers     = [for header in local.cors.allowHeaders : lower(header)]
    allow_credentials = local.cors.allowCredentials
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
    Boundary    = "north-south"
  }
}

resource "aws_apigatewayv2_stage" "public" {
  api_id      = aws_apigatewayv2_api.public.id
  name        = var.environment
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

# Internal east-west API (SAD section 3.5.2 / ADR-005)
resource "aws_apigatewayv2_api" "internal" {
  name          = "${var.project_name}-internal-${var.environment}"
  protocol_type = "HTTP"
  description   = "AutoVault LK internal service-to-service API"

  tags = {
    Project     = var.project_name
    Environment = var.environment
    Boundary    = "east-west"
  }
}

resource "aws_apigatewayv2_stage" "internal" {
  api_id      = aws_apigatewayv2_api.internal.id
  name        = var.environment
  auto_deploy = true
}

# Example integration — uncomment and set ARNs when Lambdas exist:
#
# resource "aws_apigatewayv2_integration" "auth" {
#   api_id                 = aws_apigatewayv2_api.public.id
#   integration_type       = "AWS_PROXY"
#   integration_method     = "POST"
#   integration_uri        = var.public_lambda_integrations["auth"]
#   payload_format_version = "2.0"
# }
#
# resource "aws_apigatewayv2_route" "auth_proxy" {
#   api_id    = aws_apigatewayv2_api.public.id
#   route_key = "ANY /auth/{proxy+}"
#   target    = "integrations/${aws_apigatewayv2_integration.auth.id}"
# }

output "public_api_endpoint" {
  description = "Invoke URL for the public HTTP API"
  value       = aws_apigatewayv2_stage.public.invoke_url
}

output "internal_api_endpoint" {
  description = "Invoke URL for the internal HTTP API"
  value       = aws_apigatewayv2_stage.internal.invoke_url
}

output "public_api_id" {
  value = aws_apigatewayv2_api.public.id
}

output "internal_api_id" {
  value = aws_apigatewayv2_api.internal.id
}
