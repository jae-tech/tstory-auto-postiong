import { Module } from '@nestjs/common';
import { TestController } from './test.controller';
import { TestService } from './test.service';
import { CrawlerModule } from '@/crawler/crawler.module';
import { AnalyzerModule } from '@/analyzer/analyzer.module';

/**
 * 테스트 모듈: 크롤러 및 분석기 기능을 HTTP 요청으로 테스트하기 위한 임시 모듈
 *
 * 구성:
 * - TestController: HTTP 엔드포인트 제공
 *   - POST /test/run-crawler (크롤러 테스트)
 *   - POST /test/run-gemini (Gemini 분석 테스트)
 * - TestService: 크롤러 및 분석기 서비스 호출 및 결과 가공
 * - CrawlerModule: 크롤러 기능 제공
 * - AnalyzerModule: Gemini 분석 기능 제공
 *
 * 사용 목적:
 * - 개발 중 크롤러 로직을 수동으로 테스트
 * - Gemini API 프롬프트 및 응답 검증
 * - DB Upsert 동작 확인
 * - 크롤링된 데이터 검증
 *
 * 주의:
 * - 이 모듈은 개발/테스트 환경에서만 사용해야 합니다.
 * - 프로덕션 배포 시 AppModule에서 TestModule import를 제거하거나,
 *   환경 변수를 통해 조건부로 로드하세요.
 *
 * 예시 (환경별 로드):
 * ```typescript
 * const testModules = process.env.NODE_ENV !== 'production' ? [TestModule] : [];
 *
 * @Module({
 *   imports: [
 *     ...otherModules,
 *     ...testModules,
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Module({
  imports: [CrawlerModule, AnalyzerModule],
  controllers: [TestController],
  providers: [TestService],
})
export class TestModule {}
