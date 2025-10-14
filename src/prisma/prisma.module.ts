import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Prisma 모듈: 전역 데이터베이스 연결 제공
 *
 * @Global 데코레이터로 인해 모든 모듈에서
 * PrismaService를 import 없이 주입받을 수 있습니다.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
