import type { AnalysisResult, CddData, ColumnMapping, LoggerData, ParsedBms, RawTable, Settings } from '../types';
import { analyze } from './analyze';
import { parseBms } from './bms';
import { suggestChiller, type LoggerAttachment } from './merge';

export interface PipelineInput {
  table: RawTable | null;
  mapping: ColumnMapping;
  settings: Settings;
  bmsFileName?: string;
  loggers: { data: LoggerData; chiller: string }[];
  cdd?: CddData | null;
}
export interface PipelineOutput {
  parsed: ParsedBms | null;
  analysis: AnalysisResult | null;
  error: string | null;
}

/**
 * Pure derivation of everything shown in the UI from the raw inputs. Because the result depends only on the
 * inputs (never on the order in which files were loaded), BMS-first and logger-first give identical output.
 */
export function runPipeline(i: PipelineInput): PipelineOutput {
  if (!i.table) return { parsed: null, analysis: null, error: null };
  try {
    const parsed = parseBms(i.table, i.mapping, i.settings, { powerOptional: i.loggers.length > 0 });
    const attachments: LoggerAttachment[] = i.loggers.map((l) => ({ logger: l.data, chiller: l.chiller }));
    const analysis = analyze({ bms: parsed, settings: i.settings, attachments, bmsFileName: i.bmsFileName, cdd: i.cdd });
    return { parsed, analysis, error: null };
  } catch (e) {
    return { parsed: null, analysis: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export { suggestChiller };
