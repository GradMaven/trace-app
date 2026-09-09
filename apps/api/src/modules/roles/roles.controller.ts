import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError, PERMISSIONS } from '@trace/shared';
import { validateCustomRole } from '@trace/domain';
import { getContext, withOrgContext, writeAuditLog } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const createRoleSchema = z.object({
  key: z.string().trim().min(3).max(40),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(280).optional(),
  permissions: z.array(z.string()).min(1).max(Object.keys(PERMISSIONS).length),
});
const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().max(280).optional(),
  permissions: z.array(z.string()).min(1).max(Object.keys(PERMISSIONS).length).optional(),
});
type CreateRoleBody = z.infer<typeof createRoleSchema>;
type UpdateRoleBody = z.infer<typeof updateRoleSchema>;

interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  memberCount: number;
  permissions: string[];
}

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  @Get()
  @RequirePermission('role.read')
  @ApiOperation({ summary: 'List roles in the active organization with their permissions.' })
  async list(@CurrentActor() actor: AuthenticatedActor): Promise<RoleView[]> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const roles = await db.role.findMany({
        where: { organizationId: actor.organizationId! },
        include: {
          permissions: { select: { permissionKey: true } },
          _count: { select: { memberships: true } },
        },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      });
      return roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        memberCount: r._count.memberships,
        permissions: r.permissions.map((p) => p.permissionKey),
      }));
    });
  }

  @Get('permissions')
  @RequirePermission('role.read')
  @ApiOperation({ summary: 'The full permission catalog (key + human description).' })
  catalog(): Array<{ key: string; description: string }> {
    return Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description }));
  }

  @Post()
  @RequirePermission('role.manage')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a custom organization role.' })
  async create(
    @Body(new ZodPipe(createRoleSchema)) body: CreateRoleBody,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ id: string }> {
    const requestId = getContext()?.requestId ?? 'unknown';
    const check = validateCustomRole(body);
    if (!check.ok) {
      throw AppError.unprocessable('role.invalid', check.errors.join(' '));
    }
    return withOrgContext(actor.organizationId!, async (db) => {
      const clash = await db.role.findFirst({
        where: { organizationId: actor.organizationId!, key: body.key.trim() },
        select: { id: true },
      });
      if (clash)
        throw AppError.conflict(
          'role.exists',
          `A role with key "${body.key.trim()}" already exists.`,
        );

      const role = await db.role.create({
        data: {
          organizationId: actor.organizationId!,
          key: body.key.trim(),
          name: body.name.trim(),
          description: body.description?.trim() ?? '',
          isSystem: false,
          permissions: { create: check.permissions.map((permissionKey) => ({ permissionKey })) },
        },
      });
      await writeAuditLog(db, {
        organizationId: actor.organizationId!,
        actorId: actor.userId,
        action: 'role.created',
        resourceType: 'role',
        resourceId: role.id,
        before: null,
        after: { key: role.key, name: role.name, permissions: check.permissions },
        requestId,
      });
      return { id: role.id };
    });
  }

  @Patch(':id')
  @RequirePermission('role.manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Edit a custom role. System roles cannot be modified.' })
  async update(
    @Param('id') id: string,
    @Body(new ZodPipe(updateRoleSchema)) body: UpdateRoleBody,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    const requestId = getContext()?.requestId ?? 'unknown';
    await withOrgContext(actor.organizationId!, async (db) => {
      const role = await db.role.findFirst({
        where: { id, organizationId: actor.organizationId! },
        include: { permissions: { select: { permissionKey: true } } },
      });
      if (!role) throw AppError.notFound('role.not_found', 'Role not found.');
      if (role.isSystem)
        throw AppError.forbidden('role.system', 'Built-in roles cannot be edited.');

      let permissions: string[] | undefined;
      if (body.permissions) {
        const check = validateCustomRole({
          key: role.key,
          name: body.name ?? role.name,
          permissions: body.permissions,
        });
        if (!check.ok) throw AppError.unprocessable('role.invalid', check.errors.join(' '));
        permissions = check.permissions;
        await db.rolePermission.deleteMany({ where: { roleId: role.id } });
        await db.rolePermission.createMany({
          data: check.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
        });
      }
      await db.role.update({
        where: { id: role.id },
        data: { name: body.name?.trim(), description: body.description?.trim() },
      });
      await writeAuditLog(db, {
        organizationId: actor.organizationId!,
        actorId: actor.userId,
        action: 'role.updated',
        resourceType: 'role',
        resourceId: role.id,
        before: {
          name: role.name,
          permissions: role.permissions.map((p) => p.permissionKey),
        },
        after: {
          name: body.name?.trim() ?? role.name,
          permissions: permissions ?? role.permissions.map((p) => p.permissionKey),
        },
        requestId,
      });
    });
  }

  @Delete(':id')
  @RequirePermission('role.manage')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a custom role that no member holds. System roles cannot be deleted.',
  })
  async remove(@Param('id') id: string, @CurrentActor() actor: AuthenticatedActor): Promise<void> {
    const requestId = getContext()?.requestId ?? 'unknown';
    await withOrgContext(actor.organizationId!, async (db) => {
      const role = await db.role.findFirst({
        where: { id, organizationId: actor.organizationId! },
        include: { _count: { select: { memberships: true } } },
      });
      if (!role) throw AppError.notFound('role.not_found', 'Role not found.');
      if (role.isSystem)
        throw AppError.forbidden('role.system', 'Built-in roles cannot be deleted.');
      if (role._count.memberships > 0) {
        throw AppError.conflict(
          'role.in_use',
          `${role._count.memberships} member(s) still hold this role. Reassign them first.`,
        );
      }
      await db.role.delete({ where: { id: role.id } });
      await writeAuditLog(db, {
        organizationId: actor.organizationId!,
        actorId: actor.userId,
        action: 'role.deleted',
        resourceType: 'role',
        resourceId: role.id,
        before: { key: role.key, name: role.name },
        after: null,
        requestId,
      });
    });
  }
}
