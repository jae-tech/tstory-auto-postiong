import { Module, Global } from '@nestjs/common';
import { PlaywrightService } from './playwright.service';

/**
 * Playwright 모듈: 전역 모듈로 설정하여 어디서든 사용 가능
 *
 * - @Global 데코레이터로 전역 모듈 설정
 * - CrawlerModule, PublisherModule에서 별도 임포트 없이 사용 가능
 */
@Global()
@Module({
  providers: [PlaywrightService],
  exports: [PlaywrightService],
})
export class PlaywrightModule {}
