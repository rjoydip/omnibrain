-- A share is either public or restricted to specific users. The recipients
-- table is only meaningful when audience = 'users'.
alter table item_shares add column audience text not null default 'public';

create table item_share_recipients (
  token text not null references item_shares(token) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  primary key (token, user_id)
);
