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
# ingestion-service: MVP deployment path, not the full design.
#
# The full design (SAD §6.6) is one Lambda per ETL stage, fanned out by a Step
# Functions state machine — src/infrastructure/step-functions/etl-state-
# machine.asl.json defines it, but nothing in AWS runs it yet, and two of its
# Lambda handlers (ingest-api, job-status-api split from it, process-images)
# were never written. Building that out is still pending.
#
# What's here instead: two Lambdas sharing one execution role ("ingestion") —
# module.ingest_api_lambda serves POST /ingest/upload and GET /jobs/{id}
# (both controllers already live in one NestJS app, ingestion-service/src/
# app.module.ts), and module.etl_worker_lambda is SQS-triggered and runs the
# exact same LocalOrchestrator the local/Docker path and every unit test
# already exercise — the whole pipeline in one Lambda invocation per job,
# instead of fanned out across the ASL's per-stage Lambdas. See
# ingestion-service/src/lambda/etl-worker.ts.
#
# Known limitation: a job's entire pipeline (parse, Groq, embed, image
# processing, load) has to finish inside one Lambda invocation, capped at 15
# minutes. Fine for the file sizes this has been tested against; a dealer
# upload large enough to blow that budget needs the real Step Functions
# fan-out, not a bigger timeout here.
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

  # Default is ["auth", "marketplace", "admin", "notification"] — "ingestion"
  # added now that module.ingest_api_lambda / module.etl_worker_lambda exist.
  db_service_roles = ["auth", "marketplace", "admin", "notification", "ingestion"]
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

  # Default is ["auth", "marketplace", "admin", "notification"] — "ingestion"
  # added for the two ingestion Lambdas (they share one execution role; see
  # module.ingest_api_lambda / module.etl_worker_lambda below).
  service_names = ["auth", "marketplace", "admin", "notification", "ingestion"]

  service_extra_secret_arns = {
    auth         = [module.secrets.db_service_role_arns["auth"]]
    marketplace  = [module.secrets.db_service_role_arns["marketplace"], module.secrets.groq_api_key_arn]
    admin        = [module.secrets.db_service_role_arns["admin"]]
    notification = [module.secrets.db_service_role_arns["notification"]]
    ingestion    = [module.secrets.db_service_role_arns["ingestion"], module.secrets.groq_api_key_arn]
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

module "images" {
  source = "../../modules/s3-images"

  project_name = var.project_name
  environment  = var.environment

  # marketplace mints presigned GET URLs (see IMAGE_SERVE_MODE=s3 in
  # marketplace-service) — reader access. It also now owns the manual
  # listing image upload endpoint (POST /listings/:id/images), so it needs
  # PutObject too — writer access. ingestion-service's raw/staging/images
  # prefixes (see this module's own comment above) live in this same bucket —
  # writer access covers both PutObject and GetObject, which is all the ETL
  # pipeline needs to write and re-read its own inter-stage output.
  reader_role_names = [module.iam.role_names["marketplace"]]
  writer_role_names = [module.iam.role_names["marketplace"], module.iam.role_names["ingestion"]]

  cors_allowed_origins = ["https://${module.frontend.distribution_domain_name}"]
}

# Sensitive KYC documents (NIC scans, business registration certificates) —
# a separate bucket from vehicle images on purpose: distinct IAM roles and
# access pattern (only auth, which owns upload/resolve during registration,
# and admin, which only resolves a viewing URL for the approval screen —
# never marketplace or the public). See DOCUMENT_SERVE_MODE in
# auth-user-service and admin-service's document-serve.config.ts.
module "verification_documents" {
  source = "../../modules/s3-images"

  project_name          = var.project_name
  environment           = var.environment
  bucket_name_override  = "${var.project_name}-verification-docs-${var.environment}"

  reader_role_names = [module.iam.role_names["auth"], module.iam.role_names["admin"]]
  writer_role_names = [module.iam.role_names["auth"]]

  # No direct browser upload/GET the way vehicle images use CORS for — every
  # verification-document read is a backend-minted presigned URL an admin
  # opens directly, and upload goes through auth-user-service's own API, so
  # this stays scoped to the frontend origin rather than the images bucket's
  # cors_allowed_origins default.
  cors_allowed_origins = ["https://${module.frontend.distribution_domain_name}"]
}

locals {
  db_url = {
    for svc in ["auth", "marketplace", "admin", "notification", "ingestion"] :
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
    # Verification-document upload (FR-02.1) — same s3/local/demo modes as
    # marketplace's image serving; production always runs s3.
    DOCUMENT_SERVE_MODE      = "s3"
    VERIFICATION_DOCS_BUCKET = module.verification_documents.bucket_name
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
    # NFR-19: presigned GET URLs, never a public bucket. IMAGE_SERVE_MODE=s3
    # is production's default; dev/local environments run demo or local
    # instead (see .env.example and image-serve.config.ts).
    IMAGE_SERVE_MODE          = "s3"
    MARKETPLACE_IMAGES_BUCKET = module.images.bucket_name
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
    # Resolves a stored verification-document key into a presigned URL for
    # the dealer approval screen — read-only, never uploads (see
    # DocumentUrlResolverService in admin-service).
    DOCUMENT_SERVE_MODE      = "s3"
    VERIFICATION_DOCS_BUCKET = module.verification_documents.bucket_name
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

    # NotificationRetrySweeper's own setInterval never fires reliably in
    # Lambda — the process freezes between invocations, so the timer only
    # ticks during the brief window a request happens to be in flight.
    # aws_cloudwatch_event_rule.notification_retry_sweep below is the real
    # trigger; disable the in-process one so it isn't silently doing nothing.
    NOTIFICATION_RETRY_ENABLED = "false"
  })
}

# -----------------------------------------------------------------------------
# FR-53's actual trigger in Lambda. EventBridge invokes the notification
# Lambda directly (not through API Gateway) with a fixed payload that
# src/lambda/notifier.ts recognizes and routes straight to
# NotificationRetrySweeper.sweep(), bypassing serverless-express entirely.
# rate(1 minute) is EventBridge's finest granularity; the sweeper's own
# DEFAULT_INTERVAL_MS (30s) doesn't translate directly, but a due retry is
# just picked up on the next minute rather than the next 30s.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "notification_retry_sweep" {
  name                = "${var.project_name}-notification-retry-sweep-${var.environment}"
  description         = "Drives FR-53: periodically invokes the notification Lambda to retry due notification sends."
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "notification_retry_sweep" {
  rule = aws_cloudwatch_event_rule.notification_retry_sweep.name
  arn  = module.notification_lambda.function_arn
  input = jsonencode({
    action = "sweep-notifications"
  })
}

resource "aws_lambda_permission" "notification_retry_sweep" {
  statement_id  = "AllowEventBridgeRetrySweep"
  action        = "lambda:InvokeFunction"
  function_name = module.notification_lambda.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.notification_retry_sweep.arn
}

# -----------------------------------------------------------------------------
# ingestion-service (MVP path — see the note at the top of this file).
#
# One SQS queue takes the place of the Step Functions execution the full
# design would start: POST /ingest/upload (module.ingest_api_lambda, via
# SqsJobQueue) sends {jobId} here, and module.etl_worker_lambda's event
# source mapping picks it up and runs LocalOrchestrator.run(jobId) — the
# whole pipeline, in one invocation, per FR-30.1's chunk fan-out happening
# inside that call rather than across separate Lambdas.
# -----------------------------------------------------------------------------

resource "aws_sqs_queue" "ingestion_jobs_dlq" {
  name = "${var.project_name}-ingestion-jobs-dlq-${var.environment}"
  # 14 days: long enough that a stuck job can be investigated and redriven
  # manually rather than lost to the queue's own retention window.
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "ingestion_jobs" {
  name = "${var.project_name}-ingestion-jobs-${var.environment}"

  # Matches module.etl_worker_lambda's timeout: SQS requires the queue's
  # visibility timeout to be at least the consuming Lambda's timeout, or a
  # slow job would become visible to a second poller before the first
  # invocation finishes.
  visibility_timeout_seconds = 900

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ingestion_jobs_dlq.arn
    # FR-41.3: after 3 failed deliveries (not 3 failed pipeline runs —
    # LocalOrchestrator marks the job FAILED internally and returns
    # normally, so a redelivery only happens when the invocation itself
    # crashed or timed out), the message moves to the DLQ instead of
    # retrying forever.
    maxReceiveCount = 3
  })
}

data "aws_iam_policy_document" "ingestion_sqs_access" {
  statement {
    sid    = "SendUploadJobs"
    effect = "Allow"
    actions = [
      "sqs:SendMessage",
    ]
    resources = [aws_sqs_queue.ingestion_jobs.arn]
  }

  statement {
    sid    = "ConsumeUploadJobs"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.ingestion_jobs.arn]
  }

  # Shared by both Lambdas rather than split (ingest-api only ever needs
  # Send, etl-worker only ever needs Receive/Delete) — this MVP path uses one
  # execution role for both, so the statements are combined here rather than
  # attaching two separate aws_iam_role_policy resources to the same role.
}

resource "aws_iam_role_policy" "ingestion_sqs_access" {
  name   = "ingestion-sqs-access"
  role   = module.iam.role_names["ingestion"]
  policy = data.aws_iam_policy_document.ingestion_sqs_access.json
}

module "ingest_api_lambda" {
  source = "../../modules/lambda"

  project_name       = var.project_name
  environment        = var.environment
  service_name       = "ingest-api"
  image_tag          = var.image_tag
  execution_role_arn = module.iam.role_arns["ingestion"]
  subnet_ids         = module.networking.private_subnet_ids
  security_group_ids = [module.networking.lambda_security_group_id]

  environment_variables = merge(local.common_env, {
    INGESTION_DATABASE_URL   = local.db_url["ingestion"]
    INGESTION_STORAGE_DRIVER = "s3"
    INGESTION_S3_BUCKET      = module.images.bucket_name
    INGESTION_QUEUE_DRIVER   = "sqs"
    INGESTION_SQS_QUEUE_URL  = aws_sqs_queue.ingestion_jobs.url
  })
}

module "etl_worker_lambda" {
  source = "../../modules/lambda"

  project_name       = var.project_name
  environment        = var.environment
  service_name       = "etl-worker"
  image_tag          = var.image_tag
  execution_role_arn = module.iam.role_arns["ingestion"]
  subnet_ids         = module.networking.private_subnet_ids
  security_group_ids = [module.networking.lambda_security_group_id]

  # 3008 MB / 900 s: the heaviest single stage (embed, the MiniLM ONNX model)
  # already needs 3008 MB on its own in the full per-stage design, and this
  # Lambda runs that stage plus Groq normalization, image processing (Sharp)
  # and the database load all in the same invocation. 900s (15 min) is
  # Lambda's hard ceiling — see the "known limitation" note at the top of
  # this file.
  memory_size = 3008
  timeout     = 900

  environment_variables = merge(local.common_env, {
    INGESTION_DATABASE_URL    = local.db_url["ingestion"]
    INGESTION_STORAGE_DRIVER  = "s3"
    INGESTION_S3_BUCKET       = module.images.bucket_name
    INGESTION_QUEUE_DRIVER    = "sqs"
    INGESTION_SQS_QUEUE_URL   = aws_sqs_queue.ingestion_jobs.url
    GROQ_API_KEY              = var.groq_api_key
    GROQ_MODEL                = "openai/gpt-oss-20b"
    GROQ_TIMEOUT_MS           = "4000"
    EMBEDDING_DISABLED        = "false"
    NOTIFICATION_INTERNAL_URL = "${module.api_gateway.internal_api_endpoint}/notifications"
    NOTIFICATION_TIMEOUT_MS   = "5000"
  })
}

resource "aws_lambda_event_source_mapping" "ingestion_jobs" {
  event_source_arn = aws_sqs_queue.ingestion_jobs.arn
  function_name    = module.etl_worker_lambda.function_name
  batch_size       = 1
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
    documents         = module.auth_lambda.invoke_arn
    marketplace       = module.marketplace_lambda.invoke_arn
    admin             = module.admin_lambda.invoke_arn
    # Both controllers (IngestionController, JobStatusController) live in the
    # one ingest-api Lambda's NestJS app — see the ingestion-service note at
    # the top of this file.
    ingest = module.ingest_api_lambda.invoke_arn
    jobs   = module.ingest_api_lambda.invoke_arn
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

resource "aws_lambda_permission" "ingest_api_public" {
  statement_id  = "AllowPublicApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.ingest_api_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.public_api_execution_arn}/*/*"
}

module "github_oidc" {
  source = "../../modules/github-oidc"

  project_name         = var.project_name
  environment          = var.environment
  github_org           = var.github_org
  github_repo          = var.github_repo
  create_oidc_provider = var.create_github_oidc_provider

  ecr_repository_arns = [
    module.auth_lambda.ecr_repository_arn,
    module.marketplace_lambda.ecr_repository_arn,
    module.admin_lambda.ecr_repository_arn,
    module.notification_lambda.ecr_repository_arn,
    module.ingest_api_lambda.ecr_repository_arn,
    module.etl_worker_lambda.ecr_repository_arn,
  ]

  lambda_function_arns = [
    module.auth_lambda.function_arn,
    module.marketplace_lambda.function_arn,
    module.admin_lambda.function_arn,
    module.notification_lambda.function_arn,
    module.ingest_api_lambda.function_arn,
    module.etl_worker_lambda.function_arn,
  ]

  frontend_bucket_arn       = module.frontend.bucket_arn
  frontend_distribution_arn = module.frontend.distribution_arn
}

output "github_deploy_role_arn" {
  description = "Put this in the deploy workflow's role-to-assume, and it's the only value that needs to change if this gets redeployed to a different AWS account"
  value       = module.github_oidc.role_arn
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

output "images_bucket_name" {
  value = module.images.bucket_name
}

output "verification_documents_bucket_name" {
  value = module.verification_documents.bucket_name
output "ingestion_sqs_queue_url" {
  value = aws_sqs_queue.ingestion_jobs.url
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
    ingest-api   = module.ingest_api_lambda.ecr_repository_url
    etl-worker   = module.etl_worker_lambda.ecr_repository_url
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
