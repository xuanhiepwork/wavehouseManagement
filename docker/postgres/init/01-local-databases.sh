#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv dev_password POSTGRES_DEV_PASSWORD
\getenv test_password POSTGRES_TEST_PASSWORD
CREATE ROLE wavehouse_dev LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'dev_password';
CREATE ROLE wavehouse_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'test_password';
CREATE DATABASE wavehouse_dev OWNER wavehouse_dev;
CREATE DATABASE wavehouse_test OWNER wavehouse_test;
CREATE DATABASE wavehouse_shadow OWNER wavehouse_dev;
REVOKE ALL ON DATABASE wavehouse_dev, wavehouse_test, wavehouse_shadow FROM PUBLIC;
REVOKE ALL ON DATABASE wavehouse_dev, wavehouse_shadow FROM wavehouse_test;
REVOKE ALL ON DATABASE wavehouse_test FROM wavehouse_dev;
GRANT CONNECT ON DATABASE wavehouse_dev, wavehouse_shadow TO wavehouse_dev;
GRANT CONNECT ON DATABASE wavehouse_test TO wavehouse_test;
\connect wavehouse_dev
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO wavehouse_dev;
\connect wavehouse_shadow
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO wavehouse_dev;
\connect wavehouse_test
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO wavehouse_test;
SQL
