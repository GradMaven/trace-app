import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { getPrisma } from '@trace/db';
import { Public } from '../../common/decorators';

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
}
