CREATE TABLE IF NOT EXISTS attendance (
 meetup_id uuid NOT NULL, user_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','checked_in','no_show_pending','attendance_unverified','no_show')),
 method text CHECK(method IN ('location','host')), policy_version text,
 review text CHECK(review IN ('pending','approved','rejected')), reason text,
 confirmed_by uuid REFERENCES auth_user(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(meetup_id,user_id),
 FOREIGN KEY(meetup_id,user_id) REFERENCES participations(meetup_id,user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS attendance_commands (
 user_id uuid REFERENCES auth_user(id) ON DELETE CASCADE, command_id uuid NOT NULL, fingerprint text NOT NULL,
 meetup_id uuid REFERENCES meetups(id), PRIMARY KEY(user_id,command_id)
);
