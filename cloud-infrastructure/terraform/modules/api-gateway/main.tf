terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Routes and integrations are provisioned from var.public_lambda_integrations
# and var.internal_lambda_integrations (route prefix -> Lambda invoke ARN),
# mirroring api-gateway/local/nginx.conf's location blocks exactly so a
# request path behaves the same locally and in AWS.
#
# ingestion-service's /ingest and /jobs prefixes are deliberately absent —
# that service isn't deployed in this pass.
#
# The Lambda side still needs an aws_lambda_permission granting each function
# api-gateway invoke rights — that's created alongside the Lambda in the
# environment composition (it needs this module's execution ARN outputs
# below, so it can't live inside this module without a dependency cycle).
# -----------------------------------------------------------------------------

locals {
  # Single source of truth: api-gateway/config/cors.json (synced to nginx + OpenAPI via npm run sync:cors)
  cors               = jsondecode(file("${path.module}/../../../../api-gateway/config/cors.json"))
  cors_allow_origins = coalesce(var.cors_allow_origins, local.cors.allowOrigins)
}

# Public north-south API (SAD section 3.5.1)
resource "aws_apigatewayv2_api" "public" {
  name          = "${var.project_name}-public-${var.environment}"
  protocol_type = "HTTP"
  description   = "AutoVaultLK public API Gateway"

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
  api_id = aws_apigatewayv2_api.public.id

  # HTTP APIs prepend the stage name to the path forwarded to the Lambda
  # integration (event.rawPath / requestContext.http.path) for any NAMED
  # stage — e.g. a request to /health arrives at the Lambda as /production/
  # health, which none of the app's routes match. $default is the one stage
  # name that adds no path prefix at all.
  name        = "$default"
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
  description   = "AutoVaultLK internal service-to-service API"

  tags = {
    Project     = var.project_name
    Environment = var.environment
    Boundary    = "east-west"
  }
}

resource "aws_apigatewayv2_stage" "internal" {
  api_id      = aws_apigatewayv2_api.internal.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "public" {
  for_each = var.public_lambda_integrations

  api_id                 = aws_apigatewayv2_api.public.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = each.value
  payload_format_version = "2.0"
}

# Two routes per prefix: "/prefix" bare and "/prefix/{proxy+}" for
# everything under it — matches nginx's `location /prefix/` also serving an
# exact hit on `/prefix`.
resource "aws_apigatewayv2_route" "public_proxy" {
  for_each = var.public_lambda_integrations

  api_id    = aws_apigatewayv2_api.public.id
  route_key = "ANY /${each.key}/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.public[each.key].id}"
}

resource "aws_apigatewayv2_route" "public_bare" {
  for_each = var.public_lambda_integrations

  api_id    = aws_apigatewayv2_api.public.id
  route_key = "ANY /${each.key}"
  target    = "integrations/${aws_apigatewayv2_integration.public[each.key].id}"
}

resource "aws_apigatewayv2_integration" "internal" {
  for_each = var.internal_lambda_integrations

  api_id                 = aws_apigatewayv2_api.internal.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = each.value
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "internal_proxy" {
  for_each = var.internal_lambda_integrations

  api_id    = aws_apigatewayv2_api.internal.id
  route_key = "ANY /${each.key}/{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.internal[each.key].id}"
}

resource "aws_apigatewayv2_route" "internal_bare" {
  for_each = var.internal_lambda_integrations

  api_id    = aws_apigatewayv2_api.internal.id
  route_key = "ANY /${each.key}"
  target    = "integrations/${aws_apigatewayv2_integration.internal[each.key].id}"
}

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

output "public_api_execution_arn" {
  description = "For an aws_lambda_permission source_arn on the public API"
  value       = aws_apigatewayv2_api.public.execution_arn
}

output "internal_api_execution_arn" {
  description = "For an aws_lambda_permission source_arn on the internal API, and modules.iam.internal_api_execution_arn"
  value       = aws_apigatewayv2_api.internal.execution_arn
}
