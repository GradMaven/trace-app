import { Module } from '@nestjs/common';
import { ActivityDataController } from './activity-data.controller';
import { ActivityDataService } from './activity-data.service';

@Module({
  controllers: [ActivityDataController],
  providers: [ActivityDataService],
})
export class ActivityDataModule {}
