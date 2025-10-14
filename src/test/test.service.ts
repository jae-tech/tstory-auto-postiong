import { Injectable, Logger } from '@nestjs/common';
import { CrawlerService } from '@/crawler/crawler.service';
import { RawPlan } from '@prisma/client';

/**
 * 테스트 서비스 결과 인터페이스
 * 크롤러 테스트 결과를 간결하게 반환하기 위한 타입
 */
export interface CrawlerTestResult {
  success: boolean;
  totalCount: number;
  plans: Array<{
    planId: string;
    planName: string;
    carrier: string;
    price: number | null;
    dataAmount: string | null;
  }>;
  timestamp: string;
  message: string;
}

/**
 * 테스트 서비스: 크롤러 기능을 수동으로 테스트하기 위한 서비스
 *
 * HTTP 요청을 통해 크롤러를 실행하고 결과를 확인할 수 있습니다.
 * 프로덕션 환경에서는 이 모듈을 제거하거나 비활성화해야 합니다.
 */
@Injectable()
export class TestService {
  private readonly logger = new Logger(TestService.name);

  constructor(private readonly crawlerService: CrawlerService) {}

  /**
   * 크롤러 테스트 실행
   *
   * CrawlerService.runCrawlAndDetect()를 호출하여 크롤링을 수행하고,
   * 결과를 간결한 JSON 형태로 변환하여 반환합니다.
   *
   * @param useDemo true면 더미 데이터 사용, false면 실제 크롤링 (기본값: true)
   * @returns 크롤러 테스트 결과 객체
   */
  async runCrawlerTest(useDemo: boolean = true): Promise<CrawlerTestResult> {
    try {
      this.logger.log(
        `크롤러 테스트 시작 (모드: ${useDemo ? '더미 데이터' : '실제 크롤링'})`,
      );

      // 크롤러 서비스 호출
      const crawledPlans: RawPlan[] =
        await this.crawlerService.runCrawlAndDetect(useDemo);

      // 결과를 간결한 형태로 변환
      const simplifiedPlans = crawledPlans.map((plan) => ({
        planId: plan.planId,
        planName: plan.planName,
        carrier: plan.carrier,
        price: plan.price,
        dataAmount: plan.dataAmount,
      }));

      const result: CrawlerTestResult = {
        success: true,
        totalCount: crawledPlans.length,
        plans: simplifiedPlans,
        timestamp: new Date().toISOString(),
        message: `크롤링 성공: ${crawledPlans.length}개 요금제가 DB에 Upsert되었습니다.`,
      };

      this.logger.log(
        `크롤러 테스트 완료: ${crawledPlans.length}개 요금제 처리됨`,
      );

      return result;
    } catch (error) {
      this.logger.error('크롤러 테스트 실패:', error);

      // 에러 발생 시에도 일관된 형식으로 반환
      return {
        success: false,
        totalCount: 0,
        plans: [],
        timestamp: new Date().toISOString(),
        message: `크롤링 실패: ${error.message}`,
      };
    }
  }

  /**
   * 크롤러 상태 확인
   *
   * 크롤러 서비스가 정상적으로 주입되었는지 확인합니다.
   * 간단한 health check용 메서드입니다.
   *
   * @returns 크롤러 서비스 상태
   */
  async checkCrawlerStatus(): Promise<{
    status: string;
    crawler: string;
    timestamp: string;
  }> {
    return {
      status: 'OK',
      crawler: this.crawlerService ? 'Available' : 'Not Available',
      timestamp: new Date().toISOString(),
    };
  }
}
