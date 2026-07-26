import {
  readStrictJsonDocumentFile,
  parseStrictJsonDocument,
  type ReadableJsonFile,
  type StrictJsonImportErrorCode,
  type StrictJsonImportResult,
} from './import-world-spec';
import {
  projectExternalHostAssetRequest,
  ExternalHostAssetRequestError,
  type ExternalHostAssetProjection,
  type ExternalHostAssetRequestErrorCode,
} from '../integrations/external-host/asset-request';

export type ExternalHostAssetRequestImportErrorCode = StrictJsonImportErrorCode | 'import.invalid-external-host-request';

export type ExternalHostAssetRequestImportResult =
  | { ok: true; projection: ExternalHostAssetProjection }
  | {
    ok: false;
    code: ExternalHostAssetRequestImportErrorCode;
    message: string;
    requestCode?: ExternalHostAssetRequestErrorCode;
  };

function strictImportFailure(
  result: Extract<StrictJsonImportResult, { ok: false }>,
): ExternalHostAssetRequestImportResult {
  return result;
}

async function projectParsedRequest(value: unknown): Promise<ExternalHostAssetRequestImportResult> {
  try {
    return { ok: true, projection: await projectExternalHostAssetRequest(value) };
  } catch (error) {
    if (error instanceof ExternalHostAssetRequestError) {
      return {
        ok: false,
        code: 'import.invalid-external-host-request',
        requestCode: error.code,
        message: `External Host Asset Request validation failed. ${error.message}`,
      };
    }
    return {
      ok: false,
      code: 'import.invalid-external-host-request',
      message: 'The External Host Asset Request could not be projected into a World Spec.',
    };
  }
}

export async function parseExternalHostAssetRequestJson(text: string): Promise<ExternalHostAssetRequestImportResult> {
  const parsed = parseStrictJsonDocument(text, 'External Host Asset Request');
  if (!parsed.ok) return strictImportFailure(parsed);
  return projectParsedRequest(parsed.value);
}

export async function readExternalHostAssetRequestFile(
  file: ReadableJsonFile,
): Promise<ExternalHostAssetRequestImportResult> {
  const parsed = await readStrictJsonDocumentFile(file, 'External Host Asset Request');
  if (!parsed.ok) return strictImportFailure(parsed);
  return projectParsedRequest(parsed.value);
}
