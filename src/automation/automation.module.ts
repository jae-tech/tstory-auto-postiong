import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AutomationService } from './automation.service';
import { CrawlerModule } from '@/crawler/crawler.module';
import { AnalyzerModule } from '@/analyzer/analyzer.module';
import { PublisherModule } from '@/publisher/publisher.module';

/**
 * 자동화 모듈: 중앙 집중식 스케줄링 및 파이프라인 제어
 *
 * - ScheduleModule을 통해 Cron 기반 스케줄링 활성화
 * - CrawlerModule, AnalyzerModule, PublisherModule을 통합하여 전체 워크플로우 관리
 * - AutomationService가 세 가지 서비스를 순차적으로 호출
 */
@Module({
  imports: [ScheduleModule.forRoot(), CrawlerModule, AnalyzerModule, PublisherModule],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
