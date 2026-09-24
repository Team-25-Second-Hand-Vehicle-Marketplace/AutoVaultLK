import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { mapDashboard } from '../mappers/dashboard.mapper';
import { AdminReadsRepository } from '../repositories/admin-reads.repository';
import { AuditLogsRepository } from '../repositories/audit-logs.repository';
import { DocumentUrlResolverService } from './document-url-resolver.service';
import type { AuditLogsQueryDto } from '../dto/audit-logs-query.dto';

/** Keys inside verificationDocuments the resolver knows how to open — see auth-user-service's verification-documents.decorator.ts. */
const DOCUMENT_KEYS = ['businessRegistrationCertificate'] as const;

@Injectable()
export class AdminReadsService {
  constructor(
    private readonly reads: AdminReadsRepository,
    private readonly auditLogs: AuditLogsRepository,
    private readonly documentUrlResolver: DocumentUrlResolverService,
  ) {}

  async dashboard() {
    return mapDashboard(await this.reads.loadDashboardRaw());
  }

  async listUsers(verificationStatus?: string) {
    const users = await this.reads.listUsers(verificationStatus);
    return Promise.all(
      users.map(async (u) => ({
        ...u,
        dealer: u.dealer
          ? {
              ...u.dealer,
              verificationDocumentUrl: await this.resolveDocumentUrl(
                u.dealer.verificationDocuments,
              ),
            }
          : null,
      })),
    );
  }

  async findDealer(userId: string) {
    const dealer = await this.reads.findDealer(userId);
    if (!dealer) {
      throw new NotFoundException(`No dealer profile for user ${userId}`);
    }
    return {
      ...dealer,
      verificationDocumentUrl: await this.resolveDocumentUrl(dealer.verificationDocuments),
    };
  }

  /**
   * NIC (individual dealers) is stored as the plain identifier string, not a
   * document key — nothing to resolve. Only the business-cert key points at
   * a stored file.
   */
  private resolveDocumentUrl(
    documents: Record<string, unknown> | null | undefined,
  ): Promise<string | null> {
    const key = documents
      ? DOCUMENT_KEYS.map((k) => documents[k]).find((v): v is string => typeof v === 'string')
      : undefined;
    return this.documentUrlResolver.resolve(key ?? null);
  }

  listUploads(status?: string) {
    return this.reads.listUploads(status);
  }

  reports(from: Date, to: Date) {
    if (from > to) {
      throw new BadRequestException('from must be on or before to');
    }
    return this.reads.loadReports(from, to);
  }

  auditLogsSearch(query: AuditLogsQueryDto) {
    return this.auditLogs.search(query);
  }
}
