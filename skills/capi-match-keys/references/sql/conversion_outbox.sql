-- PostgreSQL 17+, UTF-8 database. Caller controls the surrounding transaction.
CREATE SCHEMA IF NOT EXISTS capi_outbox;

CREATE OR REPLACE FUNCTION capi_outbox.exact_key(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, capi_outbox AS $$
  SELECT v IS NOT NULL AND length(v) > 0
    AND v = btrim(v, U&'\0020\0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') COLLATE "C"
    AND v !~ U&'[\0001-\001f\007f-\009f]';
$$;
CREATE OR REPLACE FUNCTION capi_outbox.valid_request(v text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, capi_outbox AS $$
BEGIN
  IF v IS NULL OR length(v) = 0 THEN RETURN false; END IF;
  RETURN json_typeof(v::json) = 'object';
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;
$$;
CREATE OR REPLACE FUNCTION capi_outbox.fingerprint(v text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = pg_catalog, capi_outbox AS $$
  SELECT encode(sha256(convert_to(v, 'UTF8')), 'hex');
$$;
CREATE OR REPLACE FUNCTION capi_outbox.validate_destination(p_platform text, p_account text, p_destination text, p_event_type text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, capi_outbox AS $$
BEGIN
  IF p_platform IS NULL OR p_platform NOT IN ('meta','google','tiktok','linkedin','reddit')
    OR NOT capi_outbox.exact_key(p_account) OR NOT capi_outbox.exact_key(p_destination)
    OR NOT capi_outbox.exact_key(p_event_type) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outbox_invalid_destination';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS capi_outbox.events (
  outbox_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform text COLLATE "C" NOT NULL CHECK (platform IN ('meta','google','tiktok','linkedin','reddit')),
  account_key text COLLATE "C" NOT NULL CHECK (capi_outbox.exact_key(account_key)),
  destination_key text COLLATE "C" NOT NULL CHECK (capi_outbox.exact_key(destination_key)),
  event_type text COLLATE "C" NOT NULL CHECK (capi_outbox.exact_key(event_type)),
  business_conversion_id text COLLATE "C" NOT NULL CHECK (business_conversion_id ~ '^[0-9a-f]{64}$'),
  provider_event_id text COLLATE "C" NOT NULL CHECK (capi_outbox.exact_key(provider_event_id)),
  request_body text COLLATE "C" NOT NULL CHECK (capi_outbox.valid_request(request_body)),
  request_fingerprint text GENERATED ALWAYS AS (capi_outbox.fingerprint(request_body)) STORED,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','inflight','succeeded','retry','permanent_failure')),
  attempt_token integer NOT NULL DEFAULT 0 CHECK (attempt_token >= 0),
  worker_key text COLLATE "C" CHECK (worker_key IS NULL OR capi_outbox.exact_key(worker_key)),
  lease_until timestamptz CHECK (lease_until IS NULL OR isfinite(lease_until)),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(available_at)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(updated_at)),
  completed_at timestamptz CHECK (completed_at IS NULL OR isfinite(completed_at)),
  CONSTRAINT business_destination_unique UNIQUE (platform,account_key,destination_key,event_type,business_conversion_id),
  CONSTRAINT provider_destination_unique UNIQUE (platform,account_key,destination_key,event_type,provider_event_id),
  CHECK ((state='inflight' AND worker_key IS NOT NULL AND lease_until IS NOT NULL AND attempt_token > 0)
    OR (state<>'inflight' AND worker_key IS NULL AND lease_until IS NULL)),
  CHECK ((state IN ('succeeded','permanent_failure')) = (completed_at IS NOT NULL)),
  CHECK ((state='queued' AND attempt_token=0) OR (state<>'queued' AND attempt_token>0))
);
CREATE INDEX IF NOT EXISTS events_claim_scope ON capi_outbox.events
  (platform,account_key,destination_key,event_type,state,available_at,outbox_id);

CREATE TABLE IF NOT EXISTS capi_outbox.attempts (
  outbox_id bigint NOT NULL REFERENCES capi_outbox.events(outbox_id),
  attempt_token integer NOT NULL CHECK (attempt_token > 0),
  worker_key text COLLATE "C" NOT NULL CHECK (capi_outbox.exact_key(worker_key)),
  claimed_at timestamptz NOT NULL CHECK (isfinite(claimed_at)),
  lease_until timestamptz NOT NULL CHECK (isfinite(lease_until) AND lease_until > claimed_at),
  PRIMARY KEY (outbox_id,attempt_token)
);
CREATE TABLE IF NOT EXISTS capi_outbox.audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  outbox_id bigint NOT NULL REFERENCES capi_outbox.events(outbox_id),
  attempt_token integer NOT NULL CHECK (attempt_token >= 0),
  action text NOT NULL CHECK (action IN ('enqueued','claimed','lease_expired','succeeded','retry','permanent_failure')),
  previous_state text CHECK (previous_state IN ('queued','inflight','retry')),
  next_state text NOT NULL CHECK (next_state IN ('queued','inflight','succeeded','retry','permanent_failure')),
  worker_key text COLLATE "C" CHECK (worker_key IS NULL OR capi_outbox.exact_key(worker_key)),
  result_code text COLLATE "C" CHECK (result_code IS NULL OR result_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(recorded_at)),
  CHECK (((action='enqueued' AND attempt_token=0 AND previous_state IS NULL AND next_state='queued' AND worker_key IS NULL AND result_code IS NULL)
    OR (action='claimed' AND attempt_token>0 AND previous_state IN ('queued','retry','inflight') AND next_state='inflight' AND worker_key IS NOT NULL AND result_code IS NULL)
    OR (action='lease_expired' AND attempt_token>0 AND previous_state='inflight' AND next_state='inflight' AND worker_key IS NOT NULL AND result_code IS NULL)
    OR (action IN ('succeeded','retry','permanent_failure') AND attempt_token>0 AND previous_state='inflight' AND next_state=action AND worker_key IS NOT NULL AND result_code IS NOT NULL)) IS TRUE)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_enqueue_audit ON capi_outbox.audit(outbox_id) WHERE action='enqueued';
CREATE UNIQUE INDEX IF NOT EXISTS one_claim_audit ON capi_outbox.audit(outbox_id,attempt_token) WHERE action='claimed';
CREATE UNIQUE INDEX IF NOT EXISTS one_expiry_audit ON capi_outbox.audit(outbox_id,attempt_token) WHERE action='lease_expired';
CREATE UNIQUE INDEX IF NOT EXISTS one_completion_audit ON capi_outbox.audit(outbox_id,attempt_token)
  WHERE action IN ('succeeded','retry','permanent_failure');

CREATE OR REPLACE FUNCTION capi_outbox.prevent_history_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, capi_outbox AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outbox_append_only_history'; END;
$$;
CREATE OR REPLACE FUNCTION capi_outbox.protect_event() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, capi_outbox AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outbox_event_delete_forbidden'; END IF;
  IF ROW(NEW.outbox_id,NEW.platform,NEW.account_key,NEW.destination_key,NEW.event_type,NEW.business_conversion_id,NEW.provider_event_id,NEW.request_body,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.outbox_id,OLD.platform,OLD.account_key,OLD.destination_key,OLD.event_type,OLD.business_conversion_id,OLD.provider_event_id,OLD.request_body,OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outbox_immutable_event';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS immutable_event ON capi_outbox.events;
CREATE TRIGGER immutable_event BEFORE UPDATE OR DELETE ON capi_outbox.events FOR EACH ROW EXECUTE FUNCTION capi_outbox.protect_event();
DROP TRIGGER IF EXISTS no_event_truncate ON capi_outbox.events;
CREATE TRIGGER no_event_truncate BEFORE TRUNCATE ON capi_outbox.events FOR EACH STATEMENT EXECUTE FUNCTION capi_outbox.prevent_history_change();
DROP TRIGGER IF EXISTS append_only_attempts ON capi_outbox.attempts;
CREATE TRIGGER append_only_attempts BEFORE UPDATE OR DELETE ON capi_outbox.attempts FOR EACH ROW EXECUTE FUNCTION capi_outbox.prevent_history_change();
DROP TRIGGER IF EXISTS no_attempts_truncate ON capi_outbox.attempts;
CREATE TRIGGER no_attempts_truncate BEFORE TRUNCATE ON capi_outbox.attempts FOR EACH STATEMENT EXECUTE FUNCTION capi_outbox.prevent_history_change();
DROP TRIGGER IF EXISTS append_only_audit ON capi_outbox.audit;
CREATE TRIGGER append_only_audit BEFORE UPDATE OR DELETE ON capi_outbox.audit FOR EACH ROW EXECUTE FUNCTION capi_outbox.prevent_history_change();
DROP TRIGGER IF EXISTS no_audit_truncate ON capi_outbox.audit;
CREATE TRIGGER no_audit_truncate BEFORE TRUNCATE ON capi_outbox.audit FOR EACH STATEMENT EXECUTE FUNCTION capi_outbox.prevent_history_change();

CREATE OR REPLACE FUNCTION capi_outbox.enqueue_conversion(
  p_platform text,p_account text,p_destination text,p_event_type text,
  p_business_id text,p_provider_id text,p_request_body text)
RETURNS TABLE(disposition text,snapshot jsonb)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, capi_outbox AS $$
DECLARE r capi_outbox.events; v_now timestamptz;
BEGIN
  PERFORM capi_outbox.validate_destination(p_platform,p_account,p_destination,p_event_type);
  IF p_business_id IS NULL OR p_business_id !~ '^[0-9a-f]{64}$' OR NOT capi_outbox.exact_key(p_provider_id) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outbox_invalid_identity';
  END IF;
  IF NOT capi_outbox.valid_request(p_request_body) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outbox_invalid_request';
  END IF;
  v_now := clock_timestamp();
  INSERT INTO capi_outbox.events(platform,account_key,destination_key,event_type,business_conversion_id,provider_event_id,request_body,available_at,created_at,updated_at)
    VALUES(p_platform,p_account,p_destination,p_event_type,p_business_id,p_provider_id,p_request_body,v_now,v_now,v_now)
    ON CONFLICT DO NOTHING RETURNING * INTO r;
  IF FOUND THEN
    INSERT INTO capi_outbox.audit(outbox_id,attempt_token,action,next_state,recorded_at) VALUES(r.outbox_id,0,'enqueued','queued',v_now);
    RETURN QUERY SELECT 'inserted'::text,to_jsonb(r); RETURN;
  END IF;
  -- A new READ COMMITTED statement snapshot sees the concurrent committed row.
  SELECT * INTO r FROM capi_outbox.events e WHERE e.platform=p_platform AND e.account_key=p_account
    AND e.destination_key=p_destination AND e.event_type=p_event_type AND e.business_conversion_id=p_business_id FOR UPDATE;
  IF NOT FOUND OR r.provider_event_id IS DISTINCT FROM p_provider_id COLLATE "C"
    OR r.request_body IS DISTINCT FROM p_request_body COLLATE "C" THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='outbox_conflict';
  END IF;
  RETURN QUERY SELECT 'replayed'::text,to_jsonb(r);
END;
$$;

CREATE OR REPLACE FUNCTION capi_outbox.claim_conversions(
  p_platform text,p_account text,p_destination text,p_event_type text,p_worker text,
  p_lease_seconds numeric,p_batch_size integer)
RETURNS SETOF capi_outbox.events
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, capi_outbox AS $$
DECLARE r capi_outbox.events; old_state text; v_now timestamptz;
BEGIN
  PERFORM capi_outbox.validate_destination(p_platform,p_account,p_destination,p_event_type);
  IF NOT capi_outbox.exact_key(p_worker) OR p_lease_seconds IS NULL OR p_lease_seconds < 0.01 OR p_lease_seconds > 3600
    OR p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outbox_invalid_claim';
  END IF;
  v_now := clock_timestamp();
  FOR r IN SELECT * FROM capi_outbox.events e WHERE e.platform=p_platform AND e.account_key=p_account
    AND e.destination_key=p_destination AND e.event_type=p_event_type
    AND ((e.state IN ('queued','retry') AND e.available_at <= v_now) OR (e.state='inflight' AND e.lease_until <= v_now))
    ORDER BY e.available_at,e.outbox_id FOR UPDATE SKIP LOCKED LIMIT p_batch_size
  LOOP
    old_state := r.state; v_now := clock_timestamp();
    IF old_state='inflight' THEN
      INSERT INTO capi_outbox.audit(outbox_id,attempt_token,action,previous_state,next_state,worker_key,recorded_at)
        VALUES(r.outbox_id,r.attempt_token,'lease_expired','inflight','inflight',r.worker_key,v_now);
    END IF;
    UPDATE capi_outbox.events e SET state='inflight',attempt_token=e.attempt_token+1,worker_key=p_worker,
      lease_until=v_now+(p_lease_seconds * interval '1 second'),updated_at=v_now
      WHERE e.outbox_id=r.outbox_id RETURNING * INTO r;
    INSERT INTO capi_outbox.attempts(outbox_id,attempt_token,worker_key,claimed_at,lease_until)
      VALUES(r.outbox_id,r.attempt_token,p_worker,v_now,r.lease_until);
    INSERT INTO capi_outbox.audit(outbox_id,attempt_token,action,previous_state,next_state,worker_key,recorded_at)
      VALUES(r.outbox_id,r.attempt_token,'claimed',old_state,'inflight',p_worker,v_now);
    RETURN NEXT r;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION capi_outbox.complete_conversion(
  p_platform text,p_account text,p_destination text,p_event_type text,p_business_id text,
  p_worker text,p_attempt_token integer,p_outcome text,p_result_code text,p_available_at timestamptz DEFAULT NULL)
RETURNS TABLE(applied boolean,snapshot jsonb)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, capi_outbox AS $$
DECLARE r capi_outbox.events; v_now timestamptz;
BEGIN
  PERFORM capi_outbox.validate_destination(p_platform,p_account,p_destination,p_event_type);
  IF p_business_id IS NULL OR p_business_id !~ '^[0-9a-f]{64}$' OR NOT capi_outbox.exact_key(p_worker)
    OR p_attempt_token IS NULL OR p_attempt_token < 1 OR p_outcome IS NULL OR p_outcome NOT IN ('succeeded','retry','permanent_failure')
    OR p_result_code IS NULL OR p_result_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outbox_invalid_completion';
  END IF;
  IF (p_outcome='retry' AND (p_available_at IS NULL OR NOT isfinite(p_available_at) OR p_available_at <= clock_timestamp()))
    OR (p_outcome<>'retry' AND p_available_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outbox_invalid_retry_time';
  END IF;
  SELECT * INTO r FROM capi_outbox.events e WHERE e.platform=p_platform AND e.account_key=p_account
    AND e.destination_key=p_destination AND e.event_type=p_event_type AND e.business_conversion_id=p_business_id FOR UPDATE;
  -- Sample the database clock AFTER any row-lock wait, not at transaction start.
  v_now := clock_timestamp();
  IF p_outcome='retry' AND p_available_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='outbox_invalid_retry_time';
  END IF;
  IF NOT FOUND THEN RETURN QUERY SELECT false,NULL::jsonb; RETURN; END IF;
  IF r.state<>'inflight' OR r.worker_key IS DISTINCT FROM p_worker COLLATE "C"
    OR r.attempt_token<>p_attempt_token OR r.lease_until<=v_now THEN
    RETURN QUERY SELECT false,to_jsonb(r); RETURN;
  END IF;
  UPDATE capi_outbox.events e SET state=p_outcome,worker_key=NULL,lease_until=NULL,
    available_at=CASE WHEN p_outcome='retry' THEN p_available_at ELSE e.available_at END,
    updated_at=v_now,completed_at=CASE WHEN p_outcome IN ('succeeded','permanent_failure') THEN v_now ELSE NULL END
    WHERE e.outbox_id=r.outbox_id RETURNING * INTO r;
  INSERT INTO capi_outbox.audit(outbox_id,attempt_token,action,previous_state,next_state,worker_key,result_code,recorded_at)
    VALUES(r.outbox_id,r.attempt_token,p_outcome,'inflight',p_outcome,p_worker,p_result_code,v_now);
  RETURN QUERY SELECT true,to_jsonb(r);
END;
$$;
REVOKE ALL ON SCHEMA capi_outbox FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA capi_outbox FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA capi_outbox FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA capi_outbox FROM PUBLIC;
