import { Module } from '@nestjs/common';
import { PortalGuard } from './portal.guard';
import { SupplierPortalController } from './supplier-portal.controller';
import { SupplierPortalService } from './supplier-portal.service';

@Module({
  controllers: [SupplierPortalController],
  providers: [SupplierPortalService, PortalGuard],
})
export class SupplierPortalModule {}
