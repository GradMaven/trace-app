import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { loadEnv } from '@trace/config';
import { getPrisma } from '@trace/db';
import {
  buildHealthReport,
  heartbeatStatus,
  type HealthCheck,
  type HealthReport,
} from '@trace/domain';
import { MfaExempt, Public } from '../../common/decorators';

const STARTED_AT = Date.now();

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @ApiOperation({ summary: 'Liveness probe.' })
  live(): { status: 'ok'; time: string } {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness probe — checks database connectivity.' })
  async ready(): Promise<{ status: 'ok' | 'degraded'; database: boolean }> {
    let database = false;
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      database = true;
    } catch {
      database = false;
    }
    return { status: database ? 'ok' : 'degraded', database };
  }

  @Get('detailed')
  @Public()
  @MfaExempt()
  @ApiOperation({ summary: 'Detailed health — DB round-trip, worker heartbeat, storage driver.' })
  async detailed(): Promise<HealthReport> {
    const env = loadEnv();
    const prisma = getPrisma();
    const checks: HealthCheck[] = [];

    const t0 = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.push({ name: 'database', status: 'up', latencyMs: Date.now() - t0 });
    } catch {
      checks.push({
        name: 'database',
        status: 'down',
        latencyMs: Date.now() - t0,
        message: 'query failed',
      });
    }

    try {
      const hb = await prisma.componentHeartbeat.findUnique({ where: { component: 'worker' } });
      const hs = heartbeatStatus(hb?.beatAt ?? null);
      checks.push({
        name: 'worker',
        status: hs.status,
        message:
          hs.ageSeconds == null ? 'no heartbeat recorded' : `last beat ${hs.ageSeconds}s ago`,
      });
    } catch {
      checks.push({ name: 'worker', status: 'degraded', message: 'heartbeat unreadable' });
    }

    checks.push({
      name: 'storage',
      status: 'up',
      message: `driver=${env.STORAGE_DRIVER}`,
    });

    return buildHealthReport({
      version: process.env.npm_package_version ?? '0.0.0',
      uptimeSeconds: (Date.now() - STARTED_AT) / 1000,
      checks,
    });
  }
}
