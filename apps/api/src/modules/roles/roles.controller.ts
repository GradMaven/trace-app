import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@trace/shared';
import { withOrgContext } from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import type { AuthenticatedActor } from '../../common/auth.guard';

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
        include: { permissions: { select: { permissionKey: true } } },
        orderBy: { name: 'asc' },
      });
      return roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
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
}

interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
}
