/**
 * Layout components — re-exported from @core/layout for consumption via
 * the @shared/components/Layout alias.
 *
 * Usage:
 *   import { TransactionPageLayout, FormSectionCard } from '@shared/components/Layout';
 *   // or via the flat barrel:
 *   import { TransactionPageLayout } from '@shared/components';
 *
 * Physical files live in src/core/layout/ until Phase 3 migration.
 */
export {
  default as TransactionPageLayout,
} from '@core/layout/TransactionPageLayout';

export {
  default as TransactionHeader,
} from '@core/layout/TransactionHeader';

export {
  default as StickyActionFooter,
} from '@core/layout/StickyActionFooter';

export {
  default as FormSectionCard,
} from '@core/layout/FormSectionCard';

export {
  default as SummaryCardsRow,
} from '@core/layout/SummaryCardsRow';

export {
  default as SideSummaryPanel,
} from '@core/layout/SideSummaryPanel';

export {
  default as JournalPreviewPanel,
} from '@core/layout/JournalPreviewPanel';

export {
  default as EntityHeaderBanner,
} from '@core/layout/EntityHeaderBanner';

export {
  default as ResponsiveFormGrid,
} from '@core/layout/ResponsiveFormGrid';

export {
  default as NotesAttachmentsPanel,
} from '@core/layout/NotesAttachmentsPanel';

export {
  default as ColumnLayoutPanel,
} from '@core/layout/ColumnLayoutPanel';
