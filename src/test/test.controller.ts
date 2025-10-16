import { Controller, Post, Get, Query, Logger } from '@nestjs/common';
import { TestService, CrawlerTestResult, AnalyzerTestResult } from './test.service';

/**
 * 테스트 컨트롤러: 크롤러 기능을 HTTP 요청으로 테스트
 *
 * 프로덕션 환경에서는 이 컨트롤러를 제거하거나 인증을 추가해야 합니다.
 *
 * 사용 예:
 * - POST http://localhost:3000/test/run-crawler
 * - POST http://localhost:3000/test/run-crawler?useDemo=false (실제 크롤링)
 * - GET http://localhost:3000/test/status
 */
@Controller('test')
export class TestController {
  private readonly logger = new Logger(TestController.name);

  constructor(private readonly testService: TestService) {}

  /**
   * 크롤러 실행 엔드포인트
   *
   * POST /test/run-crawler
   * POST /test/run-crawler?useDemo=false (실제 크롤링)
   *
   * 크롤러를 실행하고 결과를 JSON으로 반환합니다.
   *
   * @param useDemo 쿼리 파라미터 (기본값: 'true')
   * @returns 크롤링 결과 및 DB Upsert 정보
   */
  @Post('run-crawler')
  async runCrawler(@Query('useDemo') useDemo?: string): Promise<CrawlerTestResult> {
    // 쿼리 파라미터를 boolean으로 변환 (기본값: true)
    const useDemoMode = useDemo === 'false' ? false : true;

    this.logger.log(`크롤러 테스트 요청 수신 (더미 모드: ${useDemoMode ? 'ON' : 'OFF'})`);

    const result = await this.testService.runCrawlerTest(useDemoMode);

    this.logger.log(`크롤러 테스트 응답: ${result.message}`);

    return result;
  }

  /**
   * 크롤러 상태 확인 엔드포인트
   *
   * GET /test/status
   *
   * 크롤러 서비스가 정상적으로 동작하는지 확인합니다.
   *
   * @returns 크롤러 서비스 상태
   */
  @Get('status')
  async getStatus(): Promise<{
    status: string;
    crawler: string;
    timestamp: string;
  }> {
    this.logger.log('크롤러 상태 확인 요청 수신');

    return await this.testService.checkCrawlerStatus();
  }

  /**
   * Gemini 일괄 분석 테스트 엔드포인트
   *
   * POST /test/run-gemini
   *
   * DB의 모든 요금제 데이터를 Gemini API로 일괄 분석합니다.
   * Gemini가 가장 적합한 요금제를 선택하고 포스팅을 생성합니다.
   *
   * @returns Gemini 일괄 분석 결과
   */
  @Post('run-gemini')
  async runGemini(): Promise<AnalyzerTestResult> {
    this.logger.log(`Gemini 일괄 분석 테스트 요청 수신`);

    const result = await this.testService.runGeminiTest();

    this.logger.log(`Gemini 일괄 분석 테스트 응답: ${result.message}`);

    return result;
  }


  /**
   * 테스트 모듈 정보 엔드포인트
   *
   * GET /test
   *
   * 사용 가능한 테스트 API 목록을 반환합니다.
   *
   * @returns API 사용 가이드
   */
  @Get()
  getTestInfo(): {
    message: string;
    endpoints: Array<{
      method: string;
      path: string;
      description: string;
      example: string;
    }>;
  } {
    return {
      message: '크롤러 및 분석기 테스트 API',
      endpoints: [
        {
          method: 'GET',
          path: '/test',
          description: '테스트 API 정보 조회',
          example: 'GET http://localhost:3000/test',
        },
        {
          method: 'GET',
          path: '/test/status',
          description: '크롤러 서비스 상태 확인',
          example: 'GET http://localhost:3000/test/status',
        },
        {
          method: 'POST',
          path: '/test/run-crawler',
          description: '크롤러 실행 (더미 데이터)',
          example: 'POST http://localhost:3000/test/run-crawler',
        },
        {
          method: 'POST',
          path: '/test/run-crawler?useDemo=false',
          description: '크롤러 실행 (실제 크롤링)',
          example: 'POST http://localhost:3000/test/run-crawler?useDemo=false',
        },
        {
          method: 'POST',
          path: '/test/run-gemini',
          description: 'Gemini 비교형 블로그 생성 테스트 (5개 테마별 TOP 10)',
          example: 'POST http://localhost:3000/test/run-gemini',
        },
      ],
    };
  }
}
