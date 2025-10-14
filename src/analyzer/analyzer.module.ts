import { Module } from '@nestjs/common';
import { AnalyzerService } from './analyzer.service';

/**
 * 분석기 모듈: Gemini API를 사용한 AI 콘텐츠 생성 기능 제공
 *
 * - AnalyzerService를 export하여 AutomationModule에서 사용
 */
@Module({
  providers: [AnalyzerService],
  exports: [AnalyzerService],
})
export class AnalyzerModule {}
