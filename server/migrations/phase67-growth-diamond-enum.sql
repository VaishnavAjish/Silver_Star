-- Phase 67: Add growth_diamond to item_category enum
-- Must be committed before any data updates use this new value

ALTER TYPE public.item_category ADD VALUE IF NOT EXISTS 'growth_diamond';
