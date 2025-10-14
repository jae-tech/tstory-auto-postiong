import { Module } from '@nestjs/common';
import { PublisherService } from './publisher.service';

/**
 * 발행기 모듈: Puppeteer를 사용한 티스토리 자동 포스팅 기능 제공
 *
 * - PublisherService를 export하여 AutomationModule에서 사용
 */
@Module({
  providers: [PublisherService],
  exports: [PublisherService],
})
export class PublisherModule {}
