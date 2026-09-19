terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# SES starts every new account in the sandbox: it can only send to addresses
# that are themselves verified, which blocks real user signups. Provisioning
# an identity here does not lift that — request production access separately
# in the SES console (Account dashboard -> "Request production access").
# There is no Terraform resource for that request.
# -----------------------------------------------------------------------------

locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
  }

  use_domain = var.domain_name != null
}

resource "aws_ses_email_identity" "sender" {
  count = var.sender_email != null ? 1 : 0
  email = var.sender_email
}

resource "aws_ses_domain_identity" "domain" {
  count  = local.use_domain ? 1 : 0
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "domain" {
  count  = local.use_domain ? 1 : 0
  domain = aws_ses_domain_identity.domain[0].domain
}

# Only created when both domain_name and route53_zone_id are set — otherwise
# add the verification TXT record manually (see the verification_token
# output) at whatever DNS provider hosts the domain.
resource "aws_route53_record" "verification" {
  count   = local.use_domain && var.route53_zone_id != null ? 1 : 0
  zone_id = var.route53_zone_id
  name    = "_amazonses.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.domain[0].verification_token]
}

resource "aws_route53_record" "dkim" {
  count   = local.use_domain && var.route53_zone_id != null ? 3 : 0
  zone_id = var.route53_zone_id
  name    = "${aws_ses_domain_dkim.domain[0].dkim_tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.domain[0].dkim_tokens[count.index]}.dkim.amazonses.com"]
}

output "identity_arn" {
  description = "Pass to modules.iam.ses_identity_arn to scope the auth Lambda's send permission"
  value       = local.use_domain ? aws_ses_domain_identity.domain[0].arn : (var.sender_email != null ? aws_ses_email_identity.sender[0].arn : null)
}

output "domain_verification_token" {
  description = "Add as a TXT record at _amazonses.<domain> if route53_zone_id was not set"
  value       = local.use_domain ? aws_ses_domain_identity.domain[0].verification_token : null
}

output "dkim_tokens" {
  description = "Add each as a CNAME <token>._domainkey.<domain> -> <token>.dkim.amazonses.com if route53_zone_id was not set"
  value       = local.use_domain ? aws_ses_domain_dkim.domain[0].dkim_tokens : null
}
