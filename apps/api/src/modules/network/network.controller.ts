import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '@trace/shared';
import {
  carbonGraphByVersion,
  carbonGraphNodeTrace,
  computeCarbonGraph,
  deleteSupplyChainEdge,
  getContext,
  latestCarbonGraph,
  listCarbonGraphSnapshots,
  listSupplyChainEdges,
  upsertSupplyChainEdge,
  withOrgContext,
  type CarbonGraphNodeTrace,
  type CarbonGraphSnapshotView,
  type SupplyChainEdgeView,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const computeSchema = z.object({
  reportingPeriod: z.string().trim().max(32).optional(),
});
const edgeSchema = z.object({
  fromSupplierId: z.string().uuid(),
  toSupplierId: z.string().uuid().optional().nullable(),
  toLabel: z.string().trim().max(200).optional().nullable(),
  relationship: z.string().trim().max(120).optional().nullable(),
  tier: z.number().int().min(1).max(20).optional().nullable(),
});

@ApiTags('network')
@Controller('network')
export class NetworkController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get('graph')
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'The latest (or a specific) computed supply-chain carbon graph.' })
  async graph(
    @CurrentActor() actor: AuthenticatedActor,
    @Query('version') version?: string,
  ): Promise<CarbonGraphSnapshotView> {
    const org = actor.organizationId!;
    const v = version ? Number.parseInt(version, 10) : undefined;
    const snap = await withOrgContext(org, (db) =>
      v && Number.isFinite(v) ? carbonGraphByVersion(db, org, v) : latestCarbonGraph(db, org),
    );
    if (!snap) {
      throw AppError.notFound('network.no_graph', 'No carbon graph has been computed yet.');
    }
    return snap;
  }

  @Get('graph/history')
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'Computed carbon-graph snapshots (metadata only).' })
  async history(@CurrentActor() actor: AuthenticatedActor): Promise<
    Awaited<ReturnType<typeof listCarbonGraphSnapshots>>
  > {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) => listCarbonGraphSnapshots(db, org));
  }

  @Post('graph/compute')
  @RequirePermission('network.manage')
  @ApiOperation({ summary: 'Recompute the supply-chain carbon graph and store a new snapshot.' })
  async compute(
    @Body(new ZodPipe(computeSchema)) body: z.infer<typeof computeSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<CarbonGraphSnapshotView> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) =>
      computeCarbonGraph(db, {
        organizationId: org,
        reportingPeriod: body.reportingPeriod,
        computedByUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('graph/nodes/:nodeId/trace')
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'Trace a node back to the root, with its backing calculations.' })
  async trace(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('nodeId') nodeId: string,
    @Query('version') version?: string,
  ): Promise<CarbonGraphNodeTrace> {
    const org = actor.organizationId!;
    const v = version ? Number.parseInt(version, 10) : undefined;
    return withOrgContext(org, (db) =>
      carbonGraphNodeTrace(db, org, nodeId, v && Number.isFinite(v) ? v : undefined),
    );
  }

  @Get('edges')
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'The tenant-declared upstream supply-chain links.' })
  async edges(@CurrentActor() actor: AuthenticatedActor): Promise<SupplyChainEdgeView[]> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) => listSupplyChainEdges(db, org));
  }

  @Post('edges')
  @RequirePermission('network.manage')
  @ApiOperation({ summary: 'Add or update a declared upstream link.' })
  async addEdge(
    @Body(new ZodPipe(edgeSchema)) body: z.infer<typeof edgeSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ id: string }> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) =>
      upsertSupplyChainEdge(db, {
        organizationId: org,
        fromSupplierId: body.fromSupplierId,
        toSupplierId: body.toSupplierId ?? null,
        toLabel: body.toLabel ?? null,
        relationship: body.relationship ?? null,
        tier: body.tier ?? null,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Delete('edges/:id')
  @RequirePermission('network.manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a declared upstream link.' })
  async removeEdge(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    const org = actor.organizationId!;
    await withOrgContext(org, (db) =>
      deleteSupplyChainEdge(db, {
        organizationId: org,
        id,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }
}
