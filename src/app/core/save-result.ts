import { saveBlob, saveFiles, type SaveOutcome } from '../../media/file-system/save';
import type { QueuedJob } from './job-queue';

/** One file goes through the save picker; a numbered run goes to a folder or a zip. */
export function saveResult(job: QueuedJob): Promise<SaveOutcome> {
  const files = job.result?.files ?? [];
  if (files.length === 1) return saveBlob(files[0].blob, files[0].name);
  return saveFiles(files, job.archiveName ?? 'cinch-output.zip');
}
