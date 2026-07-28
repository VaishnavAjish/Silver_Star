-- Phase 75: Add weight column to lot_mix_components for complete physical data tracking

ALTER TABLE lot_mix_components
  ADD COLUMN IF NOT EXISTS weight NUMERIC(15,4);
