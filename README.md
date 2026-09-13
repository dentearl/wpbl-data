# WPBL Data Pipeline (`dentearl/wpbl-data`)

Automated regular-season schedule and game results pipeline for the Women's Pro Baseball League (WPBL).

## Purpose
This repository serves static, daily-updated JSON datasets of WPBL regular-season games (including scores and standings) for the inaugural 2026 season via `raw.githubusercontent.com`.

The live baseball division visualizer dynamically fetches from:
```
https://raw.githubusercontent.com/dentearl/wpbl-data/main/data/wpbl/{season}.json
```
Available seasons: `2026` (inaugural 30-game season across 4 charter clubs: Boston Hunters, Los Angeles Queens, New York Heights, San Francisco Firebells).

## Security & Architecture
- **Zero Secrets / Zero Tokens**: Uses standard unauthenticated HTTP GET requests on the frontend and ephemeral, default `GITHUB_TOKEN` (`contents: write`) in GitHub Actions.
- **Automated Nightly Run**: Scheduled via GitHub Actions daily at `04:30 UTC` (`23:30 CDT`), shortly after games finish in Springfield, IL.

## Manual Run
```bash
npm install

# Scrape current active season
npm run scrape
# or
node scripts/scrapeWPBL.js --season 2026
```
