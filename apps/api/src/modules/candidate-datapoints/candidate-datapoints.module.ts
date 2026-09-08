import { Module } from '@nestjs/common';
import { CandidateDatapointsController } from './candidate-datapoints.controller';

@Module({ controllers: [CandidateDatapointsController] })
export class CandidateDatapointsModule {}
