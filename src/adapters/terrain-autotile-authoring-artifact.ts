/**
 * Provider-neutral, in-memory authoring input shared by every internal-review
 * pack builder. Provider-specific reports and credentials deliberately do not
 * belong to this boundary.
 */
export interface TerrainAutotileAuthoringArtifact {
  readonly cell: Readonly<{ width: number; height: number }>;
  readonly images: readonly Readonly<{
    material: string;
    path: string;
    png: Readonly<{
      byteLength: number;
      readBytes(): Uint8Array;
    }>;
  }>[];
}
