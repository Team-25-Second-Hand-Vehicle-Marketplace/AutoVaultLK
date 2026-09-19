terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    bucket       = "vehicle-marketplace-tfstate-287761904540"
    key          = "production/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true # native S3 conditional-write locking (TF 1.10+) — no DynamoDB table needed
  }
}

provider "aws" {
  region = var.aws_region
}

# -----------------------------------------------------------------------------
# ingestion-service is intentionally not composed here — no S3/SQS/Step
# Functions/ingestion Lambdas. See DEPLOYMENT-GAPS.md for what that would add.
# -----------------------------------------------------------------------------

module "networking" {
  source = "../../modules/networking"

  project_name = var.project_name
  environment  = var.environment
}

module "secrets" {
  source = "../../modules/secrets"

  project_name = var.project_name
  environment  = var.environment
  groq_api_key = var.groq_api_key
}

module "ses" {
  source = "../../modules/ses"

  project_name    = var.project_name
  environment     = var.environment
  sender_email    = var.ses_sender_email
  domain_name     = var.ses_domain_name
  route53_zone_id = var.ses_route53_zone_id
}

module "database" {
  source = "../../modules/database"

  project_name                = var.project_name
  environment                 = var.environment
  private_subnet_ids          = module.networking.private_subnet_ids
  security_group_id           = module.networking.database_security_group_id
  db_service_role_secret_arns = module.secrets.db_service_role_arns
}

module "iam" {
  source = "../../modules/iam"

  project_name       = var.project_name
  environment        = var.environment
  shared_secret_arns = [module.secrets.jwt_access_secret_arn, module.secrets.internal_service_key_arn]

  service_extra_secret_arns = {
    auth         = [module.secrets.db_service_role_arns["auth"]]
    marketplace  = [module.secrets.db_service_role_arns["marketplace"], module.secrets.groq_api_key_arn]
    admin        = [module.secrets.db_service_role_arns["admin"]]
    notification = [module.secrets.db_service_role_arns["notification"]]
  }

  ses_send_services = ["auth"]
  ses_identity_arn  = module.ses.identity_arn

  # internal_api_execution_arn is deliberately left unset here: scoping it
  # to module.api_gateway.internal_api_execution_arn would make iam depend
  # on api_gateway, which depends on lambda's invoke ARNs, which depends on
  # iam's role ARNs — a cycle. admin's execute-api:Invoke grant falls back
  # to resource "*" instead of the tightly-scoped ARN. Acceptable for this
  # pass; tightening it later means breaking that cycle (e.g. a separate
  # aws_iam_role_policy attached after both modules exist).
}

module "frontend" {
  source = "../../modules/s3"

  project_name = var.project_name
  environment  = var.environment
}

locals {
  db_url = {
    for svc in ["auth", "marketplace", "admin", "notification"] :
    svc => "postgresql://${svc}_service_role:${module.secrets.db_service_role_passwords[svc]}@${module.database.proxy_endpoint}:${module.database.port}/${module.database.db_name}"
  }

  common_env = {
    DATABASE_SSL           = "true"
    JWT_ACCESS_SECRET      = module.secrets.jwt_access_secret_value
    JWT_ISSUER             = "autovault-lk-auth"
    JWT_AUDIENCE           = "autovault-lk-api"
    JWT_ALGORITHM          = "HS256"
    JWT_ACCESS_EXPIRES_IN  = "15m"
    JWT_REFRESH_EXPIRES_IN = "7d"
    INTERNAL_SERVICE_KEY   = module.secrets.internal_service_key_value
    CORS_ORIGINS           = "https://${module.frontend.distribution_domain_name}"
    API_GATEWAY_URL        = module.api_gateway.public_api_endpoint
    FRONTEND_URL           = "https://${module.frontend.distribution_domain_name}"
    # AWS_REGION is a reserved Lambda env var — AWS sets it automatically,
    # attempting to set it yourself 400s CreateFunction. Every service's
    # code can still read process.env.AWS_REGION; it's just not something
    # Terraform is allowed to pass in.
  }
}

module "auth_lambda" {
  source = "../../modules/lambda"

  project_name       = var.project_name
  environment        = var.environment
  service_name       = "auth"
  image_tag          = var.image_tag
  execution_role_arn = module.iam.role_arns["auth"]
  subnet_ids         = module.networking.private_subnet_ids
  security_group_ids = [module.networking.lambda_security_group_id]

  environment_variables = merge(local.common_env, {
    AUTH_DATABASE_URL                = local.db_url["auth"]
    COOKIE_SECURE                    = "true"
    AUTH_USE_REFRESH_COOKIES         = "true"
    AUTH_REFRESH_TOKEN_IN_BODY       = "false"
    AUTH_RETURN_VERIFICATION_TOKEN   = tostring(var.auth_return_verification_token)
    AUTH_RETURN_PASSWORD_RESET_TOKEN = tostring(var.auth_return_verification_token)
    SES_FROM_EMAIL                   = coalesce(var.ses_sender_email, var.ses_domain_name != null ? "no-reply@${var.ses_domain_name}" : "")
    NOTIFICATION_INTERNAL_URL        = "${module.api_gateway.internal_api_endpoint}/notifications"
  })
}

module "marketplace_lambda" {
  source = "../../modules/lambda"

  project_name       = var.project_name
  environment        = var.environment
  service_name       = "marketplace"
  image_tag          = var.image_tag
  execution_role_arn = module.iam.role_arns["marketplace"]
  subnet_ids         = module.networking.private_subnet_ids
  security_group_ids = [module.networking.lambda_security_group_id]

  environment_variables = merge(local.common_env, {
    MARKETPLACE_DATABASE_URL = local.db_url["marketplace"]
    GROQ_API_KEY             = var.groq_api_key
    GROQ_MODEL               = "openai/gpt-oss-20b"
    GROQ_TIMEOUT_MS          = "4000"
    EMBEDDING_DISABLED       = "false"
    AUTH_INTERNAL_URL        = "${module.api_gateway.internal_api_endpoint}/internal"
  })
}

module "admin_lambda" {
  source = "../../modules/lambda"

  project_name       = var.project_name
  environment        = var.environment
  service_name       = "admin"
  image_tag          = var.image_tag
  execution_role_arn = module.iam.role_arns["admin"]
  subnet_ids         = module.networking.private_subnet_ids
  security_group_ids = [module.networking.lambda_security_group_id]

  environment_variables = merge(local.common_env, {
    ADMIN_DATABASE_URL        = local.db_url["admin"]
    AUTH_SERVICE_INTERNAL_URL = "${module.api_gateway.internal_api_endpoint}/internal"
    AUTH_INTERNAL_URL         = "${module.api_gateway.internal_api_endpoint}/internal"
    NOTIFICATION_INTERNAL_URL = "${module.api_gateway.internal_api_endpoint}/notifications"
  })
}

module "notification_lambda" {
  source = "../../modules/lambda"

  project_name       = var.project_name
  environment        = var.environment
  service_name       = "notification"
  image_tag          = var.image_tag
  execution_role_arn = module.iam.role_arns["notification"]
  subnet_ids         = module.networking.private_subnet_ids
  security_group_ids = [module.networking.lambda_security_group_id]

  environment_variables = merge(local.common_env, {
    NOTIFICATION_DATABASE_URL = local.db_url["notification"]
    SES_FROM_EMAIL            = coalesce(var.ses_sender_email, var.ses_domain_name != null ? "no-reply@${var.ses_domain_name}" : "")
    SES_TIMEOUT_MS            = "5000"
    # No NOTIFICATION_SQS_QUEUE_URL — the consumer disables itself gracefully
    # when unset (confirmed in sqs.consumer.ts), and there's no producer
    # anyway since ingestion isn't deployed.
  })
}

module "api_gateway" {
  source = "../../modules/api-gateway"

  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region

  # Without this, API Gateway falls back to api-gateway/config/cors.json's
  # allowOrigins — the local dev origin (http://localhost:5173), not this
  # deployment's actual CloudFront domain. API Gateway handles CORS
  # preflight itself for HTTP APIs and only adds Access-Control-Allow-Origin
  # for origins it was explicitly told about; the app's own enableCors()
  # never gets a say in it.
  cors_allow_origins = ["https://${module.frontend.distribution_domain_name}"]

  public_lambda_integrations = {
    auth              = module.auth_lambda.invoke_arn
    users             = module.auth_lambda.invoke_arn
    "dealer-profiles" = module.auth_lambda.invoke_arn
    marketplace       = module.marketplace_lambda.invoke_arn
    admin             = module.admin_lambda.invoke_arn
  }

  internal_lambda_integrations = {
    notifications = module.notification_lambda.invoke_arn
    internal      = module.auth_lambda.invoke_arn
  }
}

resource "aws_lambda_permission" "auth_public" {
  statement_id  = "AllowPublicApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.auth_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.public_api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "auth_internal" {
  statement_id  = "AllowInternalApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.auth_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.internal_api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "marketplace_public" {
  statement_id  = "AllowPublicApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.marketplace_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.public_api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "admin_public" {
  statement_id  = "AllowPublicApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.admin_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.public_api_execution_arn}/*/*"
}

resource "aws_lambda_permission" "notification_internal" {
  statement_id  = "AllowInternalApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.notification_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.internal_api_execution_arn}/*/*"
}

output "public_api_endpoint" {
  value = module.api_gateway.public_api_endpoint
}

output "private_subnet_ids" {
  description = "For launching a temporary SSM-managed bootstrap instance to reach RDS (see README's one-time DB setup)"
  value       = module.networking.private_subnet_ids
}

output "lambda_security_group_id" {
  description = "Attach this to a bootstrap instance so the database SG's ingress rule (which only allows this SG) lets it through"
  value       = module.networking.lambda_security_group_id
}

output "internal_api_endpoint" {
  value = module.api_gateway.internal_api_endpoint
}

output "frontend_url" {
  value = "https://${module.frontend.distribution_domain_name}"
}

output "frontend_bucket_name" {
  value = module.frontend.bucket_name
}

output "frontend_distribution_id" {
  value = module.frontend.distribution_id
}

output "database_proxy_endpoint" {
  value = module.database.proxy_endpoint
}

output "database_master_secret_arn" {
  description = "Fetch this to get the one-time admin credentials for running migrations + CREATE ROLE"
  value       = module.database.master_user_secret_arn
}

output "ecr_repository_urls" {
  value = {
    auth         = module.auth_lambda.ecr_repository_url
    marketplace  = module.marketplace_lambda.ecr_repository_url
    admin        = module.admin_lambda.ecr_repository_url
    notification = module.notification_lambda.ecr_repository_url
  }
}

output "db_service_role_passwords" {
  description = "Needed for the one-time CREATE ROLE step — see README.md"
  value       = module.secrets.db_service_role_passwords
  sensitive   = true
}

output "ses_domain_verification_token" {
  value = module.ses.domain_verification_token
}

output "ses_dkim_tokens" {
  value = module.ses.dkim_tokens
}
