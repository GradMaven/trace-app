import { Module } from '@nestjs/common';
import { DatapointsController } from './datapoints.controller';
import { DatapointsService } from './datapoints.service';

@Module({
  controllers: [DatapointsController],
  providers: [DatapointsService],
  exports: [DatapointsService],
})
export class DatapointsModule {}
