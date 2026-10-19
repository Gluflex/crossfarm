@echo off
rem Local API + app with a local D1 database and the mock model (no network, no cost).
rem Needs .dev.vars with AI_MOCK=1 (see README "Assistant").
cd /d "%~dp0.."
call npx wrangler d1 execute crossfarm --local --file schema.sql
call npx wrangler pages dev site --port 8788
