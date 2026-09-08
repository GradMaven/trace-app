-- Create the integration-test database alongside the dev database.
-- Runs once on first container start.
SELECT 'CREATE DATABASE trace_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'trace_test')\gexec
