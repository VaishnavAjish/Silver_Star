-- Phase 30: Concurrency-safe process number sequence
-- Replaces COUNT(*)+1 pattern that caused duplicate key violations on machine_processes.process_number

CREATE SEQUENCE IF NOT EXISTS machine_process_seq START 1 INCREMENT 1;
