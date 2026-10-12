terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# One RDS Postgres instance (pgvector + pg_trgm - both are regular CREATE
# EXTENSION statements on RDS, no custom parameter group needed) behind RDS
# Proxy. The master password is AWS-managed (manage_master_user_password),
# not a Terraform variable - apps read connection details from that
# Secrets Manager secret, output below as master_user_secret_arn.
#
# Extensions and schema come from database/'s existing migrations
# (`npm run migration:run` + `npm run grants`) - run once against
# db_instance_endpoint after this applies. Terraform only provisions the
# instance, not its contents.
# -----------------------------------------------------------------------------

locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.project_name}-db-${var.environment}"
  subnet_ids = var.private_subnet_ids
  tags       = local.tags
}

resource "aws_db_instance" "this" {
  identifier     = "${var.project_name}-db-${var.environment}"
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage = var.allocated_storage
  storage_encrypted = true

  db_name  = var.db_name
  username = var.master_username

  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = var.backup_retention_period
  skip_final_snapshot     = true

  tags = local.tags
}

data "aws_iam_policy_document" "proxy_assume" {
  count = var.enable_rds_proxy ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proxy" {
  count              = var.enable_rds_proxy ? 1 : 0
  name               = "${var.project_name}-db-proxy-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.proxy_assume[0].json
  tags               = local.tags
}

data "aws_iam_policy_document" "proxy_secret_access" {
  count = var.enable_rds_proxy ? 1 : 0
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [aws_db_instance.this.master_user_secret[0].secret_arn],
      values(var.db_service_role_secret_arns),
    )
  }
}

resource "aws_iam_role_policy" "proxy_secret_access" {
  count  = var.enable_rds_proxy ? 1 : 0
  name   = "read-master-secret"
  role   = aws_iam_role.proxy[0].id
  policy = data.aws_iam_policy_document.proxy_secret_access[0].json
}

resource "aws_db_proxy" "this" {
  count                  = var.enable_rds_proxy ? 1 : 0
  name                   = "${var.project_name}-proxy-${var.environment}"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy[0].arn
  vpc_subnet_ids         = var.private_subnet_ids
  vpc_security_group_ids = [var.security_group_id]
  require_tls            = false

  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "DISABLED"
    secret_arn  = aws_db_instance.this.master_user_secret[0].secret_arn
  }

  # One auth block per service role - the proxy has no other way to know
  # these roles exist. Each secret must hold {username, password} JSON (see
  # modules/secrets' db_password secret version); a bare password string
  # isn't enough for the proxy to identify which role it's authenticating.
  dynamic "auth" {
    for_each = var.db_service_role_secret_arns
    content {
      auth_scheme = "SECRETS"
      iam_auth    = "DISABLED"
      secret_arn  = auth.value
    }
  }

  tags = local.tags
}

resource "aws_db_proxy_default_target_group" "this" {
  count         = var.enable_rds_proxy ? 1 : 0
  db_proxy_name = aws_db_proxy.this[0].name
}

resource "aws_db_proxy_target" "this" {
  count                  = var.enable_rds_proxy ? 1 : 0
  db_proxy_name          = aws_db_proxy.this[0].name
  target_group_name      = aws_db_proxy_default_target_group.this[0].name
  db_instance_identifier = aws_db_instance.this.identifier
}

output "proxy_endpoint" {
  description = "RDS Proxy endpoint when enabled, otherwise the instance endpoint directly - callers use this output either way and don't need to know which."
  value       = var.enable_rds_proxy ? aws_db_proxy.this[0].endpoint : aws_db_instance.this.address
}

output "instance_endpoint" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "master_user_secret_arn" {
  description = "AWS-managed secret holding {username, password} for the master user"
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "instance_identifier" {
  description = "For CloudWatch alarm dimensions (AWS/RDS DBInstanceIdentifier)"
  value       = aws_db_instance.this.identifier
}

output "proxy_name" {
  description = "For CloudWatch alarm dimensions (AWS/RDS ProxyName). Empty when the proxy is disabled - the dashboard widget that uses this just shows no data, nothing fails."
  value       = var.enable_rds_proxy ? aws_db_proxy.this[0].name : ""
}
