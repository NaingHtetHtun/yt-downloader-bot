import { Test, TestingModule } from '@nestjs/testing';
import { DownloaderService } from './downloader.service';

describe('DownloaderService', () => {
  let service: DownloaderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DownloaderService],
    }).compile();

    service = module.get<DownloaderService>(DownloaderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
