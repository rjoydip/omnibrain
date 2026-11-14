-- Password sign-in. Null for accounts that only ever used email OTP.
alter table users add column password_hash text;
