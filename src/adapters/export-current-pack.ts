import { ALPHA7_PACK_VERSION } from '../core/pack-manifest-alpha7';
import {
  buildAlpha7PortablePack,
  downloadAlpha7PortablePack,
} from './export-browser-pack-alpha7';

// The Workbench keeps exporting the immutable Alpha.7 compatibility Pack.
// Later repository releases may bundle it alongside newer importer or profile
// artifacts; product-facing release labels come from current-public-release.
export const CURRENT_PACK_VERSION = ALPHA7_PACK_VERSION;
export const buildCurrentPortablePack = buildAlpha7PortablePack;
export const downloadCurrentPortablePack = downloadAlpha7PortablePack;
