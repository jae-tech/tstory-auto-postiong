import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/prisma/prisma.module';
import { AutomationModule } from '@/automation/automation.module';
import { TestModule } from '@/test/test.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

/**
 * 루트 애플리케이션 모듈
 *
 * 구성:
 * - ConfigModule: 환경 변수 관리 (전역)
 * - PrismaModule: 데이터베이스 연결 (전역)
 * - AutomationModule: 중앙 집중식 자동화 파이프라인 (ScheduleModule 포함)
 * - TestModule: 크롤러 수동 테스트를 위한 임시 모듈 (개발 환경 전용)
 *
 * 주의:
 * - TestModule은 개발/테스트 환경에서만 사용해야 합니다.
 * - 프로덕션 배포 시 TestModule import를 제거하거나 조건부로 로드하세요.
 */
@Module({
  imports: [
    // 환경 변수 설정 (전역)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Prisma 데이터베이스 모듈 (전역)
    PrismaModule,

    // 자동화 모듈 (Cron 스케줄러 및 전체 파이프라인)
    AutomationModule,

    // 테스트 모듈 (개발 환경 전용 - 프로덕션에서는 제거)
    TestModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
