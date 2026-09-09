import { CsvActivityAdapter } from './csv-activity';
import type { IntegrationAdapter, IntegrationKind } from './adapter';

const ADAPTERS: Record<IntegrationKind, IntegrationAdapter> = {
  csv_activity: new CsvActivityAdapter(),
};

export function getIntegrationAdapter(kind: string): IntegrationAdapter {
  const a = (ADAPTERS as Record<string, IntegrationAdapter | undefined>)[kind];
  if (!a) {
    throw new Error(
      `Unknown integration kind "${kind}". Known: ${Object.keys(ADAPTERS).join(', ')}.`,
    );
  }
  return a;
}

export function listIntegrationAdapters(): Array<{
  kind: IntegrationKind;
  label: string;
  targetFields: ReturnType<IntegrationAdapter['targetFields']>;
  sampleHeaders: string[];
}> {
  return Object.values(ADAPTERS).map((a) => ({
    kind: a.kind,
    label: a.label,
    targetFields: a.targetFields(),
    sampleHeaders: a.sampleHeaders(),
  }));
}
