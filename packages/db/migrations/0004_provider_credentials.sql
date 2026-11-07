-- OAuth app credentials supplied through the UI, encrypted at rest.
create table if not exists provider_credentials (
  app_id text primary key,
  client_id text not null,
  client_secret_ciphertext text not null,
  updated_at integer not null
);
