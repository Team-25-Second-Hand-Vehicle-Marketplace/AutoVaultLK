import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UploadJob } from '../../../infrastructure/database/entities/upload-job.entity';

@Injectable()
export class JobStatusRepository {
  constructor(
    @InjectRepository(UploadJob)
    private readonly uploadJobRepository: Repository<UploadJob>,
  ) {}

  async findById(id: string, dealerId: string): Promise<UploadJob | null> {
    return this.uploadJobRepository.findOne({
      select: {
        id: true,
        status: true,
        fileName: true,
        totalRecords: true,
        validRecords: true,
        invalidRecords: true,
        createdAt: true,
        updatedAt: true,
      },
      where: { id, dealerId },
    });
  }
}
