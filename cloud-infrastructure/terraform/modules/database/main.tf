terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# One RDS Postgres instance (pgvector + pg_trgm — both are regular CREATE
# EXTENSION statements on RDS, no custom parameter group needed) behind RDS
# Proxy. The master password is AWS-managed (manage_master_user_password),
# not a Terraform variable — apps read connection details from that
# Secrets Manager secret, output below as master_user_secret_arn.
#
# Extensions and schema come from database/'s existing migrations
# (`npm run migration:run` + `npm run grants`) — run once against
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
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proxy" {
  name               = "${var.project_name}-db-proxy-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.proxy_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "proxy_secret_access" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.this.master_user_secret[0].secret_arn]
  }
}

resource "aws_iam_role_policy" "proxy_secret_access" {
  name   = "read-master-secret"
  role   = aws_iam_role.proxy.id
  policy = data.aws_iam_policy_document.proxy_secret_access.json
}

resource "aws_db_proxy" "this" {
  name                   = "${var.project_name}-proxy-${var.environment}"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy.arn
  vpc_subnet_ids         = var.private_subnet_ids
  vpc_security_group_ids = [var.security_group_id]
  require_tls            = false

  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "DISABLED"
    secret_arn  = aws_db_instance.this.master_user_secret[0].secret_arn
  }

  tags = local.tags
}

resource "aws_db_proxy_default_target_group" "this" {
  db_proxy_name = aws_db_proxy.this.name
}

resource "aws_db_proxy_target" "this" {
  db_proxy_name          = aws_db_proxy.this.name
  target_group_name      = aws_db_proxy_default_target_group.this.name
  db_instance_identifier = aws_db_instance.this.identifier
}

output "proxy_endpoint" {
  description = "Use this, not the instance endpoint, for application DATABASE_URL"
  value       = aws_db_proxy.this.endpoint
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
