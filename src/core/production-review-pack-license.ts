export interface PackOutputLicense {
  readonly id: 'CC0-1.0' | 'LicenseRef-UNRELEASED';
  readonly notice_path: 'license-assets.md';
  readonly permits_redistribution: boolean;
}

export interface PackOutputProvenance {
  readonly output_provenance: 'procedural' | 'generative-ai' | 'hybrid';
  readonly contains_generative_ai: boolean;
  readonly model_provider: string | null;
  readonly model: string | null;
  readonly human_curated: boolean;
}

export function isInternalReviewPackLicense(license: PackOutputLicense): boolean {
  return license.id === 'LicenseRef-UNRELEASED'
    && license.notice_path === 'license-assets.md'
    && license.permits_redistribution === false;
}

export function isPublicCc0PackLicense(license: PackOutputLicense): boolean {
  return license.id === 'CC0-1.0'
    && license.notice_path === 'license-assets.md'
    && license.permits_redistribution === true;
}

export function validatePackOutputAuthorization(
  license: PackOutputLicense,
  provenance: PackOutputProvenance,
): readonly string[] {
  if (isPublicCc0PackLicense(license)) return Object.freeze([]);
  if (!isInternalReviewPackLicense(license)) {
    return Object.freeze(['license.output']);
  }
  const issues: string[] = [];
  if (
    provenance.contains_generative_ai !== true
    || !['generative-ai', 'hybrid'].includes(provenance.output_provenance)
    || !provenance.model_provider?.trim()
    || !provenance.model?.trim()
    || provenance.human_curated !== false
  ) {
    issues.push('license.internal-review-provenance');
  }
  return Object.freeze(issues);
}
