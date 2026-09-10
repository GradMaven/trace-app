import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '@trace/shared';
import { BENCHMARK_SECTORS } from '@trace/domain';
import {
  benchmarkComparison,
  carbonGraphByVersion,
  carbonGraphNodeTrace,
  computeCarbonGraph,
  deleteSupplyChainEdge,
  getBenchmarkSettings,
  getContext,
  getPrisma,
  latestCarbonGraph,
  listCarbonGraphSnapshots,
  listNetworkScenarios,
  listSupplyChainEdges,
  networkScenarioById,
  previewNetworkScenario,
  refreshBenchmarkBuckets,
  runNetworkScenario,
  setBenchmarkSettings,
  upsertSupplyChainEdge,
  withOrgContext,
  type BenchmarkComparisonView,
  type BenchmarkSettingsView,
  type CarbonGraphNodeTrace,
  type CarbonGraphSnapshotView,
  type NetworkScenarioView,
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

const interventionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  kind: z.enum(['decarbonize', 'substitute', 'drop_node', 'reroute']),
  label: z.string().trim().max(200).optional(),
  nodeId: z.string().trim().max(128).optional(),
  reductionPct: z.number().min(0).max(100).optional(),
  newDirectTco2e: z.number().min(0).max(1e12).optional(),
  fromNodeId: z.string().trim().max(128).optional(),
  currentToNodeId: z.string().trim().max(128).optional(),
  newToNodeId: z.string().trim().max(128).optional(),
});
const scenarioPreviewSchema = z.object({
  baseGraphVersion: z.number().int().positive().optional(),
  interventions: z.array(interventionSchema).min(1).max(30),
});
const scenarioSaveSchema = scenarioPreviewSchema.extend({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
});

const benchmarkSettingsSchema = z.object({
  sector: z.enum(BENCHMARK_SECTORS).nullable().optional(),
  optIn: z.boolean(),
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

  // ---- scenario engine ----------------------------------------------------

  @Post('scenarios/preview')
  @RequirePermission('network.manage')
  @ApiOperation({ summary: 'Project interventions against the carbon graph (not saved).' })
  preview(
    @Body(new ZodPipe(scenarioPreviewSchema)) body: z.infer<typeof scenarioPreviewSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<Awaited<ReturnType<typeof previewNetworkScenario>>> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) =>
      previewNetworkScenario(db, {
        organizationId: org,
        baseGraphVersion: body.baseGraphVersion,
        interventions: body.interventions,
      }),
    );
  }

  @Post('scenarios')
  @RequirePermission('network.manage')
  @ApiOperation({ summary: 'Run and save a network what-if scenario.' })
  runScenario(
    @Body(new ZodPipe(scenarioSaveSchema)) body: z.infer<typeof scenarioSaveSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ id: string; result: NetworkScenarioView['result'] }> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) =>
      runNetworkScenario(db, {
        organizationId: org,
        name: body.name,
        description: body.description,
        baseGraphVersion: body.baseGraphVersion,
        interventions: body.interventions,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('scenarios')
  @RequirePermission('supplier.read')
  scenarios(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<Awaited<ReturnType<typeof listNetworkScenarios>>> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) => listNetworkScenarios(db, org));
  }

  @Get('scenarios/:id')
  @RequirePermission('supplier.read')
  scenario(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<NetworkScenarioView> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) => networkScenarioById(db, org, id));
  }

  // ---- cross-tenant benchmarking ---------------------------------------

  @Get('benchmark/settings')
  @RequirePermission('network.manage')
  @ApiOperation({ summary: 'The org’s benchmarking sector + opt-in status.' })
  benchmarkSettings(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<BenchmarkSettingsView & { sectors: readonly string[] }> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) => getBenchmarkSettings(db, org)).then((s) => ({
      ...s,
      sectors: BENCHMARK_SECTORS,
    }));
  }

  @Put('benchmark/settings')
  @RequirePermission('network.manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Set the sector and opt in / out of anonymised benchmarking.' })
  async setBenchmark(
    @Body(new ZodPipe(benchmarkSettingsSchema)) body: z.infer<typeof benchmarkSettingsSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    const org = actor.organizationId!;
    await withOrgContext(org, (db) =>
      setBenchmarkSettings(db, {
        organizationId: org,
        sector: body.sector ?? null,
        optIn: body.optIn,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('benchmark')
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'This org’s data-quality ratios vs the anonymised sector aggregate.' })
  benchmark(@CurrentActor() actor: AuthenticatedActor): Promise<BenchmarkComparisonView> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) => benchmarkComparison(db, org));
  }

  @Post('benchmark/refresh')
  @RequirePermission('platform.admin')
  @ApiOperation({ summary: 'Rebuild the k-anonymised benchmark buckets (platform operators).' })
  refreshBenchmark(): Promise<Awaited<ReturnType<typeof refreshBenchmarkBuckets>>> {
    return refreshBenchmarkBuckets(getPrisma());
  }
}
