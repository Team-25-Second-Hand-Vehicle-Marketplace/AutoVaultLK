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
# ingestion-service: the full design (SAD §6.6) — one Lambda per ETL stage,
# fanned out by a Step Functions state machine
# (src/infrastructure/step-functions/etl-state-machine.asl.json). Built by
# Janith Vishula / Virusan T (see ingestion-service/docs/HANDOVER-VIRUSAN.md
# and STEP-FUNCTIONS-MIGRATION-PLAN.md); this file's job is §S8 of that plan
# — provisioning it.
#
# Two Lambdas serve the dealer-facing API: module.ingest_api_lambda
# (POST /ingest/upload) and module.job_status_api_lambda (GET /jobs/{id}),
# split into separate Lambdas per the migration plan — ingest-api.ts still
# boots the combined AppModule under the hood (harmless — nothing routes
# /jobs traffic to it), while job-status-api.ts boots a slimmer
# JobStatusAppModule (see src/job-status-app.module.ts).
#
# The pipeline itself is 12 Lambdas (module.stage_lambda_zip for the 10
# lightweight ones, module.embed_lambda and module.process_images_lambda for
# the two container-image ones — see function-config.ts for why), invoked by
# module.step_functions' state machine. An EventBridge Pipe reads the
# ingestion jobs SQS queue below and starts one execution per message —
# module.ingest_api_lambda (via SqsJobQueue) is still what publishes to it.
#
# Earlier revision of this file ran an MVP instead: one etl-worker Lambda
# running the whole pipeline per invocation via LocalOrchestrator, capped at
# its own 900s Lambda timeout. That was never applied to a real AWS account
# and is fully replaced here — see ingestion-service/src/lambda/etl-worker.ts
# for the code, which stays in place but is no longer provisioned.
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
  # added now that the ingestion Lambdas exist (ingest-api, job-status-api,
  # and the 12 ETL stage functions all share this one role).
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
  # added for every ingestion Lambda below (ingest-api, job-status-api, embed,
  # process-images, and the 10 zip-packaged stage functions) — they all share
  # this one execution role.
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

  project_name         = var.project_name
  environment          = var.environment
  bucket_name_override = "${var.project_name}-verification-docs-${var.environment}"

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

locals {
  # Only the two services that send mail get the SMTP settings (incl. the
  # password) — not every Lambda via common_env.
  smtp_env = var.smtp_host == "" ? {} : {
    SMTP_HOST = var.smtp_host
    SMTP_PORT = var.smtp_port
    SMTP_USER = var.smtp_user
    SMTP_PASS = var.smtp_password
    SMTP_FROM = var.smtp_from
  }
}

locals {
  # Base URL for service-to-service calls over the internal API. It must be the
  # API ROOT: the callers append the full path themselves (admin ->
  # /internal/dealers/{id}/approve, /notifications/events, ...), and the gateway
  # routes on that first segment. A base ending in /internal or /notifications
  # doubles it (POST /internal/internal/... -> 404). trimsuffix drops the
  # trailing slash the $default stage URL ends with.
  internal_api_base = trimsuffix(module.api_gateway.internal_api_endpoint, "/")
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

  environment_variables = merge(local.common_env, local.smtp_env, {
    AUTH_DATABASE_URL                = local.db_url["auth"]
    COOKIE_SECURE                    = "true"
    AUTH_USE_REFRESH_COOKIES         = "true"
    AUTH_REFRESH_TOKEN_IN_BODY       = "false"
    AUTH_RETURN_VERIFICATION_TOKEN   = tostring(var.auth_return_verification_token)
    AUTH_RETURN_PASSWORD_RESET_TOKEN = tostring(var.auth_return_verification_token)
    SES_FROM_EMAIL                   = coalesce(var.ses_sender_email, var.ses_domain_name != null ? "no-reply@${var.ses_domain_name}" : "")
    NOTIFICATION_INTERNAL_URL        = local.internal_api_base
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
  memory_size        = 2048 # MiniLM embedding runs inline on create; 512MB was too slow
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
    AUTH_INTERNAL_URL        = local.internal_api_base
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
    AUTH_SERVICE_INTERNAL_URL = local.internal_api_base
    AUTH_INTERNAL_URL         = local.internal_api_base
    NOTIFICATION_INTERNAL_URL = local.internal_api_base
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

  environment_variables = merge(local.common_env, local.smtp_env, {
    NOTIFICATION_DATABASE_URL = local.db_url["notification"]
    SES_FROM_EMAIL            = coalesce(var.ses_sender_email, var.ses_domain_name != null ? "no-reply@${var.ses_domain_name}" : "")
    SES_TIMEOUT_MS            = "5000"
    # No NOTIFICATION_SQS_QUEUE_URL on purpose: with no queue configured,
    # POST /notifications/events delivers synchronously (see
    # NotificationsController). The queue path still exists in code, but an
    # in-process SQS consumer cannot run reliably on Lambda, and nothing
    # provisions a queue or an SQS trigger here. Failed sends are retried by
    # the EventBridge sweep below. Callers (admin, ingestion's notify stage)
    # therefore wait for the send — hence NOTIFICATION_TIMEOUT_MS = 20000 on
    # the notify stage.

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

  # No Receive/Delete grant here — module.step_functions' EventBridge Pipe
  # consumes this queue now (via its own IAM role), not a Lambda. Earlier MVP
  # revision granted that to the "ingestion" role for etl-worker; unused now.
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

module "job_status_api_lambda" {
  source = "../../modules/lambda"

  project_name       = var.project_name
  environment        = var.environment
  service_name       = "job-status-api"
  image_tag          = var.image_tag
  execution_role_arn = module.iam.role_arns["ingestion"]
  subnet_ids         = module.networking.private_subnet_ids
  security_group_ids = [module.networking.lambda_security_group_id]

  environment_variables = merge(local.common_env, {
    INGESTION_DATABASE_URL = local.db_url["ingestion"]
  })
}

module "embed_lambda" {
  source = "../../modules/lambda"

  project_name       = var.project_name
  environment        = var.environment
  service_name       = "embed"
  image_tag          = var.image_tag
  execution_role_arn = module.iam.role_arns["ingestion"]
  subnet_ids         = module.networking.private_subnet_ids
  security_group_ids = [module.networking.lambda_security_group_id]

  # docker/embed.Dockerfile — the MiniLM ONNX model is ~90MB against a 250MB
  # unzipped zip-package layer cap, so this one stage runs as a container
  # image instead of the zip packaging the other 10 stages use.
  memory_size = 3008
  timeout     = 300

  environment_variables = merge(local.common_env, {
    INGESTION_DATABASE_URL    = local.db_url["ingestion"]
    INGESTION_STORAGE_DRIVER  = "s3"
    INGESTION_S3_BUCKET       = module.images.bucket_name
    INGESTION_MAX_CONCURRENCY = "10"
    EMBEDDING_DISABLED        = "false"
  })
}

module "process_images_lambda" {
  source = "../../modules/lambda"

  project_name       = var.project_name
  environment        = var.environment
  service_name       = "process-images"
  image_tag          = var.image_tag
  execution_role_arn = module.iam.role_arns["ingestion"]
  subnet_ids         = module.networking.private_subnet_ids
  security_group_ids = [module.networking.lambda_security_group_id]

  # docker/process-images.Dockerfile — Sharp's native binary, same reasoning
  # as embed above.
  memory_size = 2048
  timeout     = 600

  environment_variables = merge(local.common_env, {
    INGESTION_DATABASE_URL   = local.db_url["ingestion"]
    INGESTION_STORAGE_DRIVER = "s3"
    INGESTION_S3_BUCKET      = module.images.bucket_name
  })
}

# -----------------------------------------------------------------------------
# The 10 lightweight stage Lambdas — zip-packaged (see function-config.ts and
# docs/STEP-FUNCTIONS-MIGRATION-PLAN.md §S7). CI builds and uploads these
# (see ingestion-service/scripts/build-lambda-zips.mjs); Terraform reads the
# manifest ingestion-service's build emits (npm run build:lambda-config) to
# create one Lambda per entry with the right memory/timeout/env, without
# hand-duplicating function-config.ts's numbers here.
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "lambda_artifacts" {
  bucket        = "${var.project_name}-lambda-artifacts-${var.environment}"
  force_destroy = true
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_s3_bucket_public_access_block" "lambda_artifacts" {
  bucket = aws_s3_bucket.lambda_artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "lambda_artifacts" {
  bucket = aws_s3_bucket.lambda_artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

locals {
  # ingestion-service/scripts/emit-function-config.ts writes this from
  # FUNCTION_CONFIGS — the single source of truth for memory/timeout/env per
  # stage. embed and process-images are in this same manifest (packaging:
  # "image") but provisioned above as plain modules.lambda instances instead;
  # only the "zip" entries turn into stage_lambda_zip instances below.
  function_configs = jsondecode(file("${path.module}/../../../../ingestion-service/dist-lambda/function-config.json"))

  zip_function_configs = {
    for fn in local.function_configs : fn.slug => fn
    if fn.packaging == "zip"
  }

  # Every value any stage function's `env` list might ask for.
  # INGESTION_CHUNK_SIZE / INGESTION_GROQ_CONFIDENCE_THRESHOLD are
  # deliberately absent — pipeline.config.ts's app-level defaults cover them,
  # same as the earlier MVP never set them either. AWS_REGION is filtered out
  # below regardless of whether a config lists it — Lambda sets it
  # automatically and rejects an attempt to set it yourself.
  stage_env_values = {
    INGESTION_DATABASE_URL   = local.db_url["ingestion"]
    INGESTION_STORAGE_DRIVER = "s3"
    INGESTION_S3_BUCKET      = module.images.bucket_name
    DATABASE_SSL             = "true"
    # Matches the ASL's hardcoded ProcessChunks Map MaxConcurrency — must stay
    # in sync with that value if it's ever changed.
    INGESTION_MAX_CONCURRENCY = "10"
    GROQ_API_KEY              = var.groq_api_key
    GROQ_MODEL                = "openai/gpt-oss-20b"
    GROQ_TIMEOUT_MS           = "4000"
    NOTIFICATION_INTERNAL_URL = local.internal_api_base
    INTERNAL_SERVICE_KEY      = module.secrets.internal_service_key_value
    NOTIFICATION_TIMEOUT_MS   = "20000"
  }
}

module "stage_lambda_zip" {
  source   = "../../modules/lambda-zip"
  for_each = local.zip_function_configs

  project_name       = var.project_name
  environment        = var.environment
  service_name       = each.key
  s3_bucket          = aws_s3_bucket.lambda_artifacts.bucket
  s3_key             = "lambda-artifacts/${each.key}.zip"
  memory_size        = each.value.memoryMb
  timeout            = each.value.timeoutSeconds
  execution_role_arn = module.iam.role_arns["ingestion"]
  subnet_ids         = module.networking.private_subnet_ids
  security_group_ids = [module.networking.lambda_security_group_id]

  environment_variables = {
    for key in each.value.env : key => local.stage_env_values[key]
    # Excludes AWS_REGION (Lambda-reserved, never settable) and
    # INGESTION_CHUNK_SIZE / INGESTION_GROQ_CONFIDENCE_THRESHOLD (no entry in
    # stage_env_values — pipeline.config.ts's app-level defaults cover them).
    # Any key function-config.ts lists that isn't in stage_env_values is
    # assumed intentionally absent for the same reason, rather than an error.
    if contains(keys(local.stage_env_values), key)
  }
}

module "step_functions" {
  source = "../../modules/step-functions"

  project_name = var.project_name
  environment  = var.environment

  state_machine_definition_path = "${path.module}/../../../../ingestion-service/src/infrastructure/step-functions/etl-state-machine.asl.json"

  function_arns = merge(
    { for fn in local.function_configs : fn.arnPlaceholder => module.stage_lambda_zip[fn.slug].function_arn if fn.packaging == "zip" },
    {
      EmbedFunctionArn         = module.embed_lambda.function_arn
      ProcessImagesFunctionArn = module.process_images_lambda.function_arn
    }
  )

  lambda_function_arns_list = concat(
    [for fn in module.stage_lambda_zip : fn.function_arn],
    [module.embed_lambda.function_arn, module.process_images_lambda.function_arn]
  )

  sqs_queue_arn = aws_sqs_queue.ingestion_jobs.arn
}

module "monitoring" {
  source = "../../modules/monitoring"

  project_name = var.project_name
  environment  = var.environment

  lambda_function_names = merge(
    {
      auth             = module.auth_lambda.function_name
      marketplace      = module.marketplace_lambda.function_name
      admin            = module.admin_lambda.function_name
      notification     = module.notification_lambda.function_name
      "ingest-api"     = module.ingest_api_lambda.function_name
      "job-status-api" = module.job_status_api_lambda.function_name
      embed            = module.embed_lambda.function_name
      "process-images" = module.process_images_lambda.function_name
    },
    { for slug, fn in module.stage_lambda_zip : slug => fn.function_name }
  )

  sqs_queue_name = aws_sqs_queue.ingestion_jobs.name
  sqs_dlq_name   = aws_sqs_queue.ingestion_jobs_dlq.name

  db_instance_identifier = module.database.instance_identifier
  db_proxy_name          = module.database.proxy_name

  alarm_email = var.alarm_email
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
    ingest            = module.ingest_api_lambda.invoke_arn
    jobs              = module.job_status_api_lambda.invoke_arn
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

resource "aws_lambda_permission" "job_status_api_public" {
  statement_id  = "AllowPublicApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = module.job_status_api_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${module.api_gateway.public_api_execution_arn}/*/*"
}

module "github_oidc" {
  source = "../../modules/github-oidc"

  project_name         = var.project_name
  environment          = var.environment
  github_org           = var.github_org
  github_repo          = var.github_repo
  github_org_id        = var.github_org_id
  github_repo_id       = var.github_repo_id
  create_oidc_provider = var.create_github_oidc_provider

  ecr_repository_arns = [
    module.auth_lambda.ecr_repository_arn,
    module.marketplace_lambda.ecr_repository_arn,
    module.admin_lambda.ecr_repository_arn,
    module.notification_lambda.ecr_repository_arn,
    module.ingest_api_lambda.ecr_repository_arn,
    module.job_status_api_lambda.ecr_repository_arn,
    module.embed_lambda.ecr_repository_arn,
    module.process_images_lambda.ecr_repository_arn,
  ]

  lambda_function_arns = [
    module.auth_lambda.function_arn,
    module.marketplace_lambda.function_arn,
    module.admin_lambda.function_arn,
    module.notification_lambda.function_arn,
    module.ingest_api_lambda.function_arn,
    module.job_status_api_lambda.function_arn,
    module.embed_lambda.function_arn,
    module.process_images_lambda.function_arn,
  ]

  zip_lambda_function_arns   = [for fn in module.stage_lambda_zip : fn.function_arn]
  lambda_artifact_bucket_arn = aws_s3_bucket.lambda_artifacts.arn

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
}

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
    auth           = module.auth_lambda.ecr_repository_url
    marketplace    = module.marketplace_lambda.ecr_repository_url
    admin          = module.admin_lambda.ecr_repository_url
    notification   = module.notification_lambda.ecr_repository_url
    ingest-api     = module.ingest_api_lambda.ecr_repository_url
    job-status-api = module.job_status_api_lambda.ecr_repository_url
    embed          = module.embed_lambda.ecr_repository_url
    process-images = module.process_images_lambda.ecr_repository_url
  }
}

output "lambda_artifacts_bucket_name" {
  description = "Upload the 10 zip-packaged stage Lambdas' built packages here — see README's runbook"
  value       = aws_s3_bucket.lambda_artifacts.bucket
}

output "etl_state_machine_arn" {
  value = module.step_functions.state_machine_arn
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

output "alerts_sns_topic_arn" {
  description = "Subscribe an email/Slack/PagerDuty endpoint to this to receive the monitoring alarms"
  value       = module.monitoring.sns_topic_arn
}

output "monitoring_dashboard_name" {
  value = module.monitoring.dashboard_name
}
