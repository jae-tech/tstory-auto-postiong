import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CrawlerService } from '@/crawler/crawler.service';
import { AnalyzerService } from '@/analyzer/analyzer.service';
import { PublisherService } from '@/publisher/publisher.service';

/**
 * 자동화 서비스: 중앙 집중식 스케줄링 및 파이프라인 제어
 *
 * - 크롤러, 분석기, 발행기를 순차적으로 호출하여 전체 워크플로우 관리
 * - @nestjs/schedule을 사용한 Cron 기반 스케줄링
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly crawlerService: CrawlerService,
    private readonly analyzerService: AnalyzerService,
    private readonly publisherService: PublisherService,
  ) {}

  /**
   * @description 매일 오전 6시에 실행되는 자동화 스케줄러
   *
   * Crawler → Analyzer → Publisher 순서로 실행되며,
   * 중복 실행을 방지하고 에러 발생 시 로그를 남긴다.
   *
   * Cron 패턴: 0 6 * * * (매일 오전 6시)
   * - 분: 0 (정각)
   * - 시: 6 (오전 6시)
   * - 일: * (매일)
   * - 월: * (매월)
   * - 요일: * (모든 요일)
   *
   * 에러 처리:
   * - Prisma 트랜잭션 충돌 시 5분 후 자동 재시도
   * - 기타 에러는 로깅 후 다음 스케줄까지 대기
   */
  @Cron('0 6 * * *', {
    name: 'dailyAutomation',
    timeZone: 'Asia/Seoul',
  })
  async runAutomation(): Promise<void> {
    const now = new Date();
    this.logger.log('='.repeat(60));
    this.logger.log(`[Automation] Daily crawl started at ${now.toISOString()}`);
    this.logger.log(`[Automation] KST: ${now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
    this.logger.log('='.repeat(60));

    const startTime = Date.now();

    try {
      // 1단계: 크롤링 및 신규/변경 요금제 감지
      this.logger.log('[Automation] Step 1/3: Running Crawler...');
      await this.crawlerService.runCrawlAndDetect();
      this.logger.log('[Automation] Step 1/3: Crawler completed');

      // 2단계: AI 분석 및 포스트 큐 생성
      this.logger.log('[Automation] Step 2/3: Running Analyzer...');
      await this.analyzerService.runFullAnalysis();
      this.logger.log('[Automation] Step 2/3: Analyzer completed');

      // 3단계: 큐에서 대기 중인 포스트 발행
      this.logger.log('[Automation] Step 3/3: Running Publisher...');
      await this.publisherService.runPublisher();
      this.logger.log('[Automation] Step 3/3: Publisher completed');

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      this.logger.log('='.repeat(60));
      this.logger.log(`[Automation] Daily automation completed successfully (${duration}s)`);
      this.logger.log('='.repeat(60));
    } catch (error) {
      this.logger.error('[Automation] Error during daily run:', error);

      // Prisma 트랜잭션 충돌 감지 및 재시도
      const errorMessage = error?.message || '';
      const isPrismaError =
        errorMessage.includes('PrismaClientKnownRequestError') ||
        errorMessage.includes('Transaction') ||
        errorMessage.includes('deadlock');

      if (isPrismaError) {
        this.logger.warn('[Automation] Prisma transaction conflict detected');
        this.logger.warn('[Automation] Retrying automation in 5 minutes...');

        // 5분 후 재시도 (단 한 번만)
        setTimeout(
          () => {
            this.logger.log('[Automation] Starting retry after 5 minutes...');
            this.runAutomation();
          },
          5 * 60 * 1000,
        );
      } else {
        this.logger.error('[Automation] Non-retryable error occurred');
        this.logger.error('[Automation] Error stack:', error?.stack);
      }
    }
  }

  /**
   * 전체 파이프라인 수동 트리거
   *
   * @description 테스트 또는 긴급 상황 시 수동으로 자동화 파이프라인 실행
   * @returns 실행 결과 (성공 여부, 메시지, 소요 시간)
   */
  async triggerManualRun(): Promise<{
    success: boolean;
    message: string;
    duration: number;
  }> {
    this.logger.log('[Automation] Manual trigger requested');
    const startTime = Date.now();

    try {
      await this.runAutomation();
      const duration = Date.now() - startTime;

      this.logger.log(`[Automation] Manual run completed successfully (${duration}ms)`);

      return {
        success: true,
        message: '수동 파이프라인 실행 성공',
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error(`[Automation] Manual run failed (${duration}ms):`, error);

      return {
        success: false,
        message: `수동 파이프라인 실행 실패: ${error?.message || 'Unknown error'}`,
        duration,
      };
    }
  }
}
