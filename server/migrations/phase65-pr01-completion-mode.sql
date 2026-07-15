BEGIN;

DO $$
DECLARE
  v_count INTEGER;
  v_updated INTEGER;
BEGIN
  -- Require exactly one process_master row with process_code = 'pr-01'
  SELECT count(*) INTO v_count FROM process_master WHERE process_code = 'pr-01';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'phase65: expected exactly one pr-01 row, found % — aborting', v_count;
  END IF;

  -- Update only completion_mode and updated_at
  UPDATE process_master
  SET completion_mode = 'RETURN_BASED',
      updated_at = NOW()
  WHERE process_code = 'pr-01';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'phase65: expected to update exactly one row, updated % — aborting', v_updated;
  END IF;

  -- Post-assert exactly one pr-01 row has completion_mode = 'RETURN_BASED'
  SELECT count(*) INTO v_count FROM process_master 
  WHERE process_code = 'pr-01' AND completion_mode = 'RETURN_BASED';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'phase65: post-assertion failed. expected 1 row with RETURN_BASED, found %', v_count;
  END IF;

  RAISE NOTICE 'phase65: configured pr-01 with RETURN_BASED completion mode';
END $$;

COMMIT;
