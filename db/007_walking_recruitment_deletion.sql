-- A deleted account must free a recruitment seat just like leaving before start.
-- Started expeditions still retain only the anonymous shared contribution total.
CREATE OR REPLACE FUNCTION walking_anonymize_deleted_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 seoul_today date;
BEGIN
 PERFORM e.id FROM expeditions e JOIN expedition_members m ON m.expedition_id=e.id
 WHERE m.user_id=OLD.id ORDER BY e.id FOR UPDATE OF e;
 seoul_today := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
 DELETE FROM expedition_members m USING expeditions e
 WHERE m.expedition_id=e.id AND m.user_id=OLD.id AND e.starts_on>seoul_today;
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

-- Repair only empty seats retained by the old trigger while recruitment is open.
DELETE FROM expedition_members m USING expeditions e
WHERE m.expedition_id=e.id AND m.user_id IS NULL AND m.snapshot_steps=0
  AND e.starts_on>(clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
