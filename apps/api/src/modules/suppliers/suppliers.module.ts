import { Module } from '@nestjs/common';
import { EmailService } from '../auth/email.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SupplierInvitationsController } from './supplier-invitations.controller';
import { SupplierInvitationsService } from './supplier-invitations.service';
import { SupplierRequestsController } from './supplier-requests.controller';
import { SupplierRequestsService } from './supplier-requests.service';

@Module({
  controllers: [
    SuppliersController,
    SupplierInvitationsController,
    SupplierRequestsController,
  ],
  providers: [SuppliersService, SupplierInvitationsService, SupplierRequestsService, EmailService],
})
export class SuppliersModule {}
