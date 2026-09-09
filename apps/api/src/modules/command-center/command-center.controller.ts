import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { commandCenterOverview, withOrgContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const querySchema = z.object({
  reportingPeriod: z.string().max(60).optional(),
  version: z.string().max(60).optional(),
});

@ApiTags('command-center')
@Controller('command-center')
export class CommandCenterController {
  @Get('overview')
  @RequirePermission('organization.read')
  @ApiOperation({
    summary:
      'Executive overview — emissions, provenance mix, Trust, audit readiness, compliance progress, supplier coverage. Composed from real model data only.',
  })
  overview(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(querySchema)) query: z.infer<typeof querySchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      commandCenterOverview(db, actor.organizationId!, query.reportingPeriod, query.version),
    );
  }
}
