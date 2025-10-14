import { Module } from '@nestjs/common';
import { CrawlerService } from './crawler.service';
import { PrismaModule } from '@/prisma/prisma.module';

/**
 * 크롤러 모듈: Playwright를 사용한 웹 크롤링 기능 제공
 *
 * - Playwright를 통한 안정적인 브라우저 자동화
 * - PrismaService를 통한 데이터베이스 Upsert 기능
 * - CrawlerService를 export하여 다른 모듈에서 사용 가능
 */
@Module({
  imports: [PrismaModule],
  providers: [CrawlerService],
  exports: [CrawlerService],
})
export class CrawlerModule {}
