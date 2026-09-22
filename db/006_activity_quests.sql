-- Immutable migration: the journal runner applies this file exactly once.
-- Native totals are client-reported HealthKit aggregates, not proof of physical activity.
CREATE TABLE walking_devices (
 device_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id, device_id)
);
CREATE TABLE health_sources (
 user_id uuid PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
 id uuid NOT NULL UNIQUE,
 device_id uuid NOT NULL UNIQUE,
 revision bigint NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
 fingerprint text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id, device_id) REFERENCES walking_devices(user_id, device_id)
);
CREATE TABLE activity_daily (
 user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 day date NOT NULL,
 steps integer NOT NULL CHECK(steps BETWEEN 0 AND 100000),
 credited_steps integer NOT NULL CHECK(credited_steps BETWEEN 0 AND 10000),
 source_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id, day)
);
CREATE TABLE expeditions (
 id uuid PRIMARY KEY,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
 invite_code text NOT NULL UNIQUE CHECK(invite_code ~ '^[A-Z0-9]{12}$'),
 place_id text CHECK(place_id ~ '^park-[0-9]{5}-[0-9]{5}$'),
 place_name text,
 starts_on date NOT NULL,
 ends_on date NOT NULL CHECK(ends_on = starts_on + 7),
 policy_version text NOT NULL CHECK(policy_version = 'walking-v1'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((place_id IS NULL) = (place_name IS NULL))
);
CREATE TABLE expedition_members (
 id uuid PRIMARY KEY,
 expedition_id uuid NOT NULL REFERENCES expeditions(id),
 user_id uuid REFERENCES auth_user(id) ON DELETE SET NULL,
 display_name text NOT NULL,
 snapshot_steps integer NOT NULL DEFAULT 0 CHECK(snapshot_steps BETWEEN 0 AND 70000),
 joined_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_at timestamptz,
 UNIQUE(expedition_id, user_id)
);
CREATE INDEX expedition_members_user ON expedition_members(user_id, expedition_id);
CREATE TABLE expedition_contributions (
 member_id uuid NOT NULL REFERENCES expedition_members(id) ON DELETE CASCADE,
 day date NOT NULL,
 steps integer NOT NULL CHECK(steps BETWEEN 0 AND 10000),
 PRIMARY KEY(member_id, day)
);
CREATE TABLE walking_claims (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 scope text NOT NULL,
 activity_day date,
 daily_milestone integer CHECK(daily_milestone BETWEEN 1 AND 10),
 expedition_id uuid REFERENCES expeditions(id),
 stage integer CHECK(stage BETWEEN 0 AND 2),
 reward integer NOT NULL CHECK(reward > 0),
 policy_version text NOT NULL CHECK(policy_version = 'walking-v1'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id, scope),
 UNIQUE(user_id, activity_day, daily_milestone),
 UNIQUE(user_id, expedition_id, stage),
 CHECK((activity_day IS NOT NULL AND daily_milestone IS NOT NULL AND expedition_id IS NULL AND stage IS NULL AND reward=1)
    OR (activity_day IS NULL AND daily_milestone IS NULL AND expedition_id IS NOT NULL AND stage IS NOT NULL
        AND reward=CASE stage WHEN 0 THEN 5 WHEN 1 THEN 10 WHEN 2 THEN 20 END))
);
CREATE TABLE walking_badges (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 badge_id text NOT NULL CHECK(badge_id IN ('sprout','trail','summit')),
 price integer NOT NULL CHECK(price=CASE badge_id WHEN 'sprout' THEN 5 WHEN 'trail' THEN 20 WHEN 'summit' THEN 50 END),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id, badge_id)
);
CREATE TABLE walking_ledger (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 claim_id uuid UNIQUE REFERENCES walking_claims(id) ON DELETE CASCADE,
 badge_id uuid UNIQUE REFERENCES walking_badges(id) ON DELETE CASCADE,
 amount integer NOT NULL CHECK(amount <> 0),
 title text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((claim_id IS NOT NULL AND badge_id IS NULL AND amount > 0)
    OR (claim_id IS NULL AND badge_id IS NOT NULL AND amount < 0))
);
CREATE INDEX walking_ledger_user ON walking_ledger(user_id, created_at DESC, id DESC);
CREATE TABLE walking_commands (
 user_id uuid NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
 command_id uuid NOT NULL,
 action text NOT NULL,
 fingerprint text NOT NULL,
 result_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id, command_id)
);
CREATE INDEX walking_commands_budget ON walking_commands(user_id, created_at DESC);

-- Deletion keeps only an anonymous, nonprivate expedition progress snapshot.
-- Private daily totals, source/device bindings, claims and ledger cascade away.
-- All expedition locks use UUID order, matching the service; there is no owner role.
CREATE FUNCTION walking_anonymize_deleted_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM e.id FROM expeditions e JOIN expedition_members m ON m.expedition_id=e.id
 WHERE m.user_id=OLD.id ORDER BY e.id FOR UPDATE OF e;
 UPDATE expedition_members m SET
   snapshot_steps=m.snapshot_steps+COALESCE((SELECT sum(c.steps) FROM expedition_contributions c WHERE c.member_id=m.id),0),
   display_name='탈퇴한 사용자', withdrawn_at=COALESCE(m.withdrawn_at,now())
 WHERE m.user_id=OLD.id;
 DELETE FROM expedition_contributions c USING expedition_members m
 WHERE c.member_id=m.id AND m.user_id=OLD.id;
 UPDATE expedition_members SET user_id=NULL WHERE user_id=OLD.id;
 RETURN OLD;
END;
$$;
CREATE TRIGGER walking_user_deleted BEFORE DELETE ON auth_user
FOR EACH ROW EXECUTE FUNCTION walking_anonymize_deleted_user();
