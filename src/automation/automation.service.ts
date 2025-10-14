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
   * 스케줄에 따라 실행되는 전체 자동화 파이프라인
   * 기본: 매일 새벽 3시 (Asia/Seoul 타임존)
   * Cron 형식: 초 분 시 일 월 요일
   */
  @Cron('0 0 3 * * *', {
    name: 'fullPipeline',
    timeZone: 'Asia/Seoul',
  })
  async runFullPipeline(): Promise<void> {
    this.logger.log('='.repeat(60));
    this.logger.log('전체 자동화 파이프라인 시작');
    this.logger.log('='.repeat(60));

    const startTime = Date.now();

    try {
      // 1단계: 크롤링 및 신규/변경 요금제 감지
      this.logger.log('1단계: 크롤러 및 변경 감지 실행 중...');
      const detectedPlans = await this.crawlerService.runCrawlAndDetect();
      this.logger.log(`1단계 완료: ${detectedPlans.length}개 신규 요금제 감지`);

      // 2단계: 신규 요금제가 있으면 AI 분석 및 포스트 큐 생성
      if (detectedPlans.length > 0) {
        this.logger.log('2단계: AI 분석 및 큐 생성 실행 중...');
        const analyzerResult = await this.analyzerService.runAnalyzer();
        this.logger.log(
          `2단계 완료: ${analyzerResult.processed}개 포스트 분석, ${analyzerResult.failed}개 실패`,
        );
      } else {
        this.logger.log('2단계 건너뛰기: 분석할 신규 요금제 없음');
      }

      // 3단계: 큐에서 대기 중인 포스트 발행
      this.logger.log('3단계: 대기 중인 포스트 발행 실행 중...');
      const publishResult = await this.publisherService.runPublisher();
      this.logger.log(`3단계 완료: ${publishResult.processed}개 포스트 발행됨`);

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      this.logger.log('='.repeat(60));
      this.logger.log(`전체 자동화 파이프라인 성공적으로 완료 (${duration}초 소요)`);
      this.logger.log('='.repeat(60));
    } catch (error) {
      this.logger.error('전체 자동화 파이프라인 실패:', error);
      this.logger.error('에러 스택:', error.stack);

      // 예외를 던지지 않음 - Cron이 계속 실행되도록 유지
      // 선택사항: 알림 서비스 구현 (이메일, Slack 등)
    }
  }

  /**
   * 선택사항: 발행기 전용 별도 Cron 작업
   * 2시간마다 실행하여 대기 중인 포스트 확인
   */
  @Cron('0 0 */2 * * *', {
    name: 'publisherOnly',
    timeZone: 'Asia/Seoul',
  })
  async runPublisherOnly(): Promise<void> {
    this.logger.log('발행기 전용 작업 실행 중...');

    try {
      const result = await this.publisherService.runPublisher();
      this.logger.log(`발행기 전용 작업 완료: ${result.processed}개 포스트 발행됨`);
    } catch (error) {
      this.logger.error('발행기 전용 작업 실패:', error);
    }
  }

  /**
   * 전체 파이프라인 수동 트리거 (필요시 다른 서비스/컨트롤러에서 호출 가능)
   */
  async triggerManualRun(): Promise<{
    success: boolean;
    message: string;
    duration: number;
  }> {
    const startTime = Date.now();

    try {
      await this.runFullPipeline();
      const duration = Date.now() - startTime;

      return {
        success: true,
        message: '수동 파이프라인 실행 성공',
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      return {
        success: false,
        message: `수동 파이프라인 실행 실패: ${error.message}`,
        duration,
      };
    }
  }
}
