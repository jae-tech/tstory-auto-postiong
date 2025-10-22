import { Injectable, Logger } from '@nestjs/common';
import { CrawlerService } from '@/crawler/crawler.service';
import { AnalyzerService } from '@/analyzer/analyzer.service';
import { PublisherService } from '@/publisher/publisher.service';
import { PrismaService } from '@/prisma/prisma.service';
import { RawPlan } from '@prisma/client';

/**
 * 테스트 서비스 결과 인터페이스
 * 크롤러 테스트 결과를 간결하게 반환하기 위한 타입
 */
export interface CrawlerTestResult {
  success: boolean;
  totalCount: number;
  plans: Array<{
    mvno: string;
    network: string;
    technology: string;
    pricePromo: number;
    dataBaseGB: number;
  }>;
  timestamp: string;
  message: string;
}

/**
 * Gemini 분석 테스트 결과 인터페이스
 */
export interface AnalyzerTestResult {
  success: boolean;
  planId: string;
  mvno: string;
  title: string;
  htmlBody: string;
  tags: string[];
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

  constructor(
    private readonly crawlerService: CrawlerService,
    private readonly analyzerService: AnalyzerService,
    private readonly publisherService: PublisherService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 크롤러 테스트 실행
   *
   * CrawlerService.runCrawlAndDetect()를 호출하여 크롤링을 수행하고,
   * 결과를 간결한 JSON 형태로 변환하여 반환합니다.
   *
   * @param useDemo true면 더미 데이터 사용, false면 실제 크롤링 (기본값: true)
   * @returns 크롤러 테스트 결과 객체
   */
  async runCrawlerTest(useDemo = true): Promise<CrawlerTestResult> {
    try {
      this.logger.log(`크롤러 테스트 시작 (모드: ${useDemo ? '더미 데이터' : '실제 크롤링'})`);

      // 크롤러 서비스 호출
      const crawledPlans: RawPlan[] = await this.crawlerService.runCrawlAndDetect(useDemo);

      const result: CrawlerTestResult = {
        success: true,
        totalCount: crawledPlans.length,
        plans: crawledPlans,
        timestamp: new Date().toISOString(),
        message: `크롤링 성공: ${crawledPlans.length}개 요금제가 DB에 Upsert되었습니다.`,
      };

      this.logger.log(`크롤러 테스트 완료: ${crawledPlans.length}개 요금제 처리됨`);

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
   * U+ 알뜰폰 크롤러 테스트 실행
   *
   * U+ 알뜰폰 공식몰만 크롤링하여 결과를 반환합니다.
   *
   * @returns 크롤러 테스트 결과 객체
   */
  async runCrawlerTestUplus(): Promise<CrawlerTestResult> {
    try {
      this.logger.log('U+ 알뜰폰 크롤러 테스트 시작');

      // U+ 알뜰폰만 크롤링
      const crawledPlans: RawPlan[] = await this.crawlerService.crawlAndSavePlans(false, [
        'uplus',
      ]);

      const result: CrawlerTestResult = {
        success: true,
        totalCount: crawledPlans.length,
        plans: crawledPlans,
        timestamp: new Date().toISOString(),
        message: `U+ 알뜰폰 크롤링 성공: ${crawledPlans.length}개 요금제가 DB에 Upsert되었습니다.`,
      };

      this.logger.log(`U+ 알뜰폰 크롤러 테스트 완료: ${crawledPlans.length}개 요금제 처리됨`);

      return result;
    } catch (error) {
      this.logger.error('U+ 알뜰폰 크롤러 테스트 실패:', error);

      return {
        success: false,
        totalCount: 0,
        plans: [],
        timestamp: new Date().toISOString(),
        message: `U+ 알뜰폰 크롤링 실패: ${error.message}`,
      };
    }
  }

  /**
   * Gemini 일괄 분석 테스트 실행
   *
   * DB의 모든 요금제를 조회하여 Gemini API로 일괄 분석합니다.
   * Gemini가 가장 적합한 요금제를 선택하고 포스팅을 생성합니다.
   *
   * @returns Gemini 일괄 분석 결과
   */
  async runGeminiTest(): Promise<AnalyzerTestResult> {
    try {
      this.logger.log(`Gemini 일괄 분석 테스트 시작`);

      // 모든 요금제 조회
      const plans = await this.prisma.rawPlan.findMany({
        orderBy: { pricePromo: 'asc' },
      });

      if (plans.length === 0) {
        return {
          success: false,
          planId: '',
          mvno: '',
          title: '',
          htmlBody: '',
          tags: [],
          timestamp: new Date().toISOString(),
          message: 'DB에 요금제 데이터가 없습니다. 먼저 크롤러를 실행하세요.',
        };
      }

      this.logger.log(`${plans.length}개 요금제 데이터로 비교형 블로그 생성 실행`);

      // 분석기 워크플로우 실행
      const result = await this.analyzerService.runFullAnalysis();

      if (!result.success) {
        return {
          success: false,
          planId: '',
          mvno: '',
          title: '',
          htmlBody: '',
          tags: [],
          timestamp: new Date().toISOString(),
          message: `비교형 블로그 생성 실패`,
        };
      }

      // PostQueue에서 최신 포스트 조회
      const latestPost = await this.prisma.postQueue.findFirst({
        orderBy: { createdAt: 'desc' },
      });

      if (!latestPost) {
        return {
          success: false,
          planId: '',
          mvno: '',
          title: '',
          htmlBody: '',
          tags: [],
          timestamp: new Date().toISOString(),
          message: `포스트 큐에 데이터가 없습니다`,
        };
      }

      this.logger.log(`비교형 블로그 생성 완료: ${latestPost.title}`);

      return {
        success: true,
        planId: 'COMPARISON_POST',
        mvno: 'Multiple',
        title: latestPost.title,
        htmlBody: latestPost.htmlBody,
        tags: latestPost.tags,
        timestamp: new Date().toISOString(),
        message: `비교형 블로그 생성 성공: ${plans.length}개 요금제 기반 - ${latestPost.title}`,
      };
    } catch (error) {
      this.logger.error('Gemini 일괄 분석 테스트 실패:', error);

      return {
        success: false,
        planId: '',
        mvno: '',
        title: '',
        htmlBody: '',
        tags: [],
        timestamp: new Date().toISOString(),
        message: `Gemini 일괄 분석 실패: ${error.message}`,
      };
    }
  }

  /**
   * 세션 초기화 테스트 실행
   *
   * 티스토리 로그인을 수행하고 세션을 저장합니다.
   *
   * @returns 세션 초기화 결과
   */
  async runSessionInitTest(): Promise<{
    success: boolean;
    message: string;
    timestamp: string;
  }> {
    try {
      this.logger.log('세션 초기화 테스트 시작');

      // 세션 초기화 실행
      await this.publisherService.initSession();

      this.logger.log('세션 초기화 테스트 완료');

      return {
        success: true,
        message: '세션 초기화 성공. 이제 로그인 없이 포스팅할 수 있습니다.',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('세션 초기화 테스트 실패:', error);

      return {
        success: false,
        message: `세션 초기화 실패: ${error.message}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Publisher 테스트 실행
   *
   * PostQueue에서 PENDING 상태인 포스트를 가져와 티스토리에 발행합니다.
   *
   * @returns Publisher 테스트 결과
   */
  async runPublisherTest(): Promise<{
    success: boolean;
    postId: number | null;
    title: string;
    status: string;
    timestamp: string;
    message: string;
  }> {
    try {
      this.logger.log('Publisher 테스트 시작');

      // PostQueue에서 PENDING 포스트 조회
      const pendingPost = await this.prisma.postQueue.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      });

      if (!pendingPost) {
        return {
          success: false,
          postId: null,
          title: '',
          status: 'NO_POST',
          timestamp: new Date().toISOString(),
          message:
            '발행할 포스트가 없습니다. 먼저 /test/run-gemini를 실행하여 포스트를 생성하세요.',
        };
      }

      this.logger.log(`포스트 발행 시작: ${pendingPost.title} (ID: ${pendingPost.id})`);

      // Publisher 서비스 실행
      await this.publisherService.publishSinglePost(pendingPost);

      // 발행 후 상태 확인
      const updatedPost = await this.prisma.postQueue.findUnique({
        where: { id: pendingPost.id },
      });

      this.logger.log(`포스트 발행 완료: ${updatedPost?.status}`);

      return {
        success: updatedPost?.status === 'PUBLISHED',
        postId: pendingPost.id,
        title: pendingPost.title,
        status: updatedPost?.status || 'UNKNOWN',
        timestamp: new Date().toISOString(),
        message: `포스트 발행 ${updatedPost?.status === 'PUBLISHED' ? '성공' : '실패'}: ${pendingPost.title}`,
      };
    } catch (error) {
      this.logger.error('Publisher 테스트 실패:', error);

      return {
        success: false,
        postId: null,
        title: '',
        status: 'ERROR',
        timestamp: new Date().toISOString(),
        message: `포스트 발행 실패: ${error.message}`,
      };
    }
  }
}
