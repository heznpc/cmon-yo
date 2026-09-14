CREATE TABLE IF NOT EXISTS posts (
 id uuid PRIMARY KEY, author_id uuid REFERENCES auth_user(id) ON DELETE SET NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
 sport text NOT NULL CHECK(sport IN ('walking','running','cycling')), region_code text CHECK(region_code ~ '^[0-9]{5}$'),
 place_id text, meetup_id uuid REFERENCES meetups(id), version integer NOT NULL DEFAULT 1,
 hidden boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_feed ON posts(created_at DESC,id DESC) WHERE NOT hidden;
CREATE TABLE IF NOT EXISTS comments (
 id uuid PRIMARY KEY, author_id uuid REFERENCES auth_user(id) ON DELETE SET NULL,
 post_id uuid REFERENCES posts(id), meetup_id uuid REFERENCES meetups(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), version integer NOT NULL DEFAULT 1,
 hidden boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((post_id IS NULL) <> (meetup_id IS NULL))
);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id,created_at,id);
CREATE INDEX IF NOT EXISTS comments_meetup ON comments(meetup_id,created_at,id);
CREATE TABLE IF NOT EXISTS community_blocks (
 user_id uuid REFERENCES auth_user(id) ON DELETE CASCADE, blocked_id uuid REFERENCES auth_user(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,blocked_id), CHECK(user_id<>blocked_id)
);
CREATE TABLE IF NOT EXISTS community_reports (
 id uuid PRIMARY KEY, user_id uuid REFERENCES auth_user(id) ON DELETE SET NULL,
 target text NOT NULL CHECK(target IN ('post','comment')), target_id uuid NOT NULL, reason text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','hidden','dismissed')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,target,target_id)
);
CREATE TABLE IF NOT EXISTS community_commands (
 user_id uuid REFERENCES auth_user(id) ON DELETE CASCADE, command_id uuid NOT NULL, fingerprint text NOT NULL,
 result_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,command_id)
);
CREATE INDEX IF NOT EXISTS community_commands_rate ON community_commands(user_id,created_at);
CREATE TABLE IF NOT EXISTS user_profiles (
 user_id uuid PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
 region_code text CHECK(region_code ~ '^[0-9]{5}$'), version integer NOT NULL DEFAULT 0
);

ALTER TABLE posts ALTER COLUMN region_code DROP NOT NULL;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_region_code_check;
ALTER TABLE posts ADD CONSTRAINT posts_region_code_check CHECK (region_code ~ '^[0-9]{5}$');
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_region_code_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_region_code_check CHECK (region_code ~ '^[0-9]{5}$');
