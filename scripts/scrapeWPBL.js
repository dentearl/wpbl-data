/**
 * WPBL (Women's Pro Baseball League) Schedule & Game Results Extractor
 * 
 * Fetches and normalizes live schedule, regular season box scores,
 * and postseason series results from womensprobaseballleague.com/schedule/
 * (REST API endpoint: /wp-json/wpbl/v1/calendar-events) for the inaugural 2026 WPBL season.
 * 
 * Outputs production-grade JSON to data/wpbl/, public/data/wpbl/, and src/data/wpbl/
 * as well as embedded JS modules in src/data/wpbl/ for zero-server file:/// compatibility.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const WPBL_CALENDAR_ENDPOINT = 'https://www.womensprobaseballleague.com/wp-json/wpbl/v1/calendar-events';

export const WPBL_TEAM_MAPPING = {
  'BOS': { id: 4001, abbrev: 'BOS', name: 'Boston Hunters', league: 'WPBL', division: 'WPBL', city: 'Boston, MA' },
  'HNT': { id: 4001, abbrev: 'BOS', name: 'Boston Hunters', league: 'WPBL', division: 'WPBL', city: 'Boston, MA' },
  'LA':  { id: 4002, abbrev: 'LA',  name: 'Los Angeles Queens', league: 'WPBL', division: 'WPBL', city: 'Los Angeles, CA' },
  'QNS': { id: 4002, abbrev: 'LA',  name: 'Los Angeles Queens', league: 'WPBL', division: 'WPBL', city: 'Los Angeles, CA' },
  'NY':  { id: 4003, abbrev: 'NY',  name: 'New York Heights', league: 'WPBL', division: 'WPBL', city: 'New York, NY' },
  'HTS': { id: 4003, abbrev: 'NY',  name: 'New York Heights', league: 'WPBL', division: 'WPBL', city: 'New York, NY' },
  'SF':  { id: 4004, abbrev: 'SF',  name: 'San Francisco Firebells', league: 'WPBL', division: 'WPBL', city: 'San Francisco, CA' },
  'FBL': { id: 4004, abbrev: 'SF',  name: 'San Francisco Firebells', league: 'WPBL', division: 'WPBL', city: 'San Francisco, CA' }
};

export const WPBL_ALIASES = {
  'BOS': 4001,
  'HNT': 4001,
  'HUNTERS': 4001,
  'BOSTON': 4001,
  'BOSTON HUNTERS': 4001,
  'LA': 4002,
  'QNS': 4002,
  'QUEENS': 4002,
  'LOS ANGELES': 4002,
  'LOS ANGELES QUEENS': 4002,
  'NY': 4003,
  'HTS': 4003,
  'HEIGHTS': 4003,
  'NEW YORK': 4003,
  'NEW YORK HEIGHTS': 4003,
  'SF': 4004,
  'FBL': 4004,
  'FIREBELLS': 4004,
  'SAN FRANCISCO': 4004,
  'SAN FRANCISCO FIREBELLS': 4004
};

/**
 * Resolves raw team name or abbreviation to canonical WPBL team object
 */
export function resolveWpblTeam(rawName) {
  if (!rawName) return null;
  const trimmed = rawName.trim().toUpperCase();
  if (WPBL_TEAM_MAPPING[trimmed]) {
    return WPBL_TEAM_MAPPING[trimmed];
  }
  const aliasId = WPBL_ALIASES[trimmed];
  if (aliasId) {
    return Object.values(WPBL_TEAM_MAPPING).find(t => t.id === aliasId) || null;
  }
  for (const team of Object.values(WPBL_TEAM_MAPPING)) {
    if (team.name.toUpperCase().includes(trimmed)) {
      return team;
    }
  }
  return null;
}

/**
 * Parses CDT official date and ISO timestamp for a WPBL game event.
 * Springfield, IL operates in America/Chicago (CDT, UTC-5 during season).
 */
export function parseCdtDateTime(isoString) {
  if (!isoString) return { officialDate: '2026-08-01', gameDate: '2026-08-01T17:00:00-05:00' };
  const d = new Date(isoString);
  if (isNaN(d.getTime())) {
    const rawDate = isoString.slice(0, 10);
    return { officialDate: rawDate, gameDate: `${rawDate}T17:00:00-05:00` };
  }
  const officialDate = d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const gameDate = `${officialDate}T${time}-05:00`;
  return { officialDate, gameDate };
}

/**
 * Fetches live calendar events from the WPBL WordPress REST API.
 */
export async function fetchWpblCalendarEvents(url = WPBL_CALENDAR_ENDPOINT, timeoutMs = 12000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) WPBL-Data-Scraper/1.0'
      }
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`[fetchWpblCalendarEvents] HTTP ${res.status}: ${res.statusText}`);
      return null;
    }
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch (err) {
    console.warn(`[fetchWpblCalendarEvents] Failed to fetch events from ${url}:`, err.message);
    return null;
  }
}

/**
 * Parses raw WPBL calendar events into regular season games and structured postseason data.
 */
export function parseWpblEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return {
      regularSeasonGames: generateWpbl2026Schedule(),
      postseasonData: getDefault2026PostseasonData()
    };
  }

  const regEvents = [];
  const playoffEvents = [];

  events.forEach(e => {
    const u = (e.url || '').toLowerCase();
    const t = (e.title || '').toLowerCase();
    if (u.includes('playoff') || u.includes('semi') || u.includes('championship') || t.includes('championship') || t.includes('semi-final') || t.includes('playoff')) {
      playoffEvents.push(e);
    } else {
      regEvents.push(e);
    }
  });

  // Parse Regular Season Games
  const regularSeasonGames = regEvents.map((item, idx) => {
    const props = item.extendedProps || {};
    const { officialDate, gameDate } = parseCdtDateTime(item.start);
    const awayTeam = resolveWpblTeam(props.awayAbbr || props.awayTeam) || WPBL_TEAM_MAPPING['BOS'];
    const homeTeam = resolveWpblTeam(props.homeAbbr || props.homeTeam) || WPBL_TEAM_MAPPING['SF'];

    const awayScore = typeof props.awayScore === 'number' ? props.awayScore : 0;
    const homeScore = typeof props.homeScore === 'number' ? props.homeScore : 0;
    const isFinal = (props.status || '').toLowerCase() === 'final';

    const gameNumStr = String(idx + 1).padStart(3, '0');
    const gamePk = `${officialDate.replace(/-/g, '')}04${gameNumStr}`;

    return {
      gamePk,
      season: 2026,
      league: 'WPBL',
      gameDate,
      officialDate,
      venue: {
        id: 4901,
        name: props.venue || 'Robin Roberts Stadium',
        city: 'Springfield, IL'
      },
      status: {
        detailedState: isFinal ? 'Final' : 'Scheduled',
        abstractGameState: isFinal ? 'F' : 'P'
      },
      teams: {
        away: {
          team: {
            id: awayTeam.id,
            name: awayTeam.name,
            abbrev: awayTeam.abbrev,
            league: 'WPBL',
            division: 'WPBL'
          },
          score: awayScore,
          isWinner: isFinal ? awayScore > homeScore : false
        },
        home: {
          team: {
            id: homeTeam.id,
            name: homeTeam.name,
            abbrev: homeTeam.abbrev,
            league: 'WPBL',
            division: 'WPBL'
          },
          score: homeScore,
          isWinner: isFinal ? homeScore > awayScore : false
        }
      },
      isTie: false
    };
  });

  // Sort games chronologically
  regularSeasonGames.sort((a, b) => a.gameDate.localeCompare(b.gameDate));

  // Parse Postseason Series Data
  const postseasonData = parseWpblPostseason(playoffEvents, regularSeasonGames);

  return { regularSeasonGames, postseasonData };
}

/**
 * Builds structured WPBL postseason series object from playoff events.
 */
export function parseWpblPostseason(playoffEvents = [], regularSeasonGames = []) {
  // Official Regular Season Standings / Seeds:
  // 1. San Francisco Firebells (10-5)
  // 2. New York Heights (8-7, won season series 3-2 vs LA)
  // 3. Los Angeles Queens (8-7)
  // 4. Boston Hunters (4-11)
  const seeds = {
    1: { id: 4004, name: 'San Francisco Firebells', shortName: 'Firebells' },
    2: { id: 4003, name: 'New York Heights', shortName: 'Heights' },
    3: { id: 4002, name: 'Los Angeles Queens', shortName: 'Queens' },
    4: { id: 4001, name: 'Boston Hunters', shortName: 'Hunters' }
  };

  const seriesAEvents = playoffEvents.filter(e => {
    const u = (e.url || '').toLowerCase();
    const t = (e.title || '').toLowerCase();
    return u.includes('series-a') || t.includes('series a');
  });

  const seriesBEvents = playoffEvents.filter(e => {
    const u = (e.url || '').toLowerCase();
    const t = (e.title || '').toLowerCase();
    return u.includes('series-b') || t.includes('series b');
  });

  const champEvents = playoffEvents.filter(e => {
    const u = (e.url || '').toLowerCase();
    const t = (e.title || '').toLowerCase();
    return u.includes('championship') || t.includes('championship');
  });

  seriesAEvents.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  seriesBEvents.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  champEvents.sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  // --- Series A: #1 SF vs #4 BOS (Best of 3) ---
  const team1 = { id: 4004, name: 'San Francisco Firebells', wins: 0, isWinner: false, isEliminated: false };
  const team4 = { id: 4001, name: 'Boston Hunters', wins: 0, isWinner: false, isEliminated: false };
  const seriesAGames = [];

  seriesAEvents.forEach((ev, idx) => {
    const props = ev.extendedProps || {};
    const { officialDate } = parseCdtDateTime(ev.start);
    const awayTeam = resolveWpblTeam(props.awayAbbr || props.awayTeam) || WPBL_TEAM_MAPPING['BOS'];
    const homeTeam = resolveWpblTeam(props.homeAbbr || props.homeTeam) || WPBL_TEAM_MAPPING['SF'];
    const isFinal = (props.status || '').toLowerCase() === 'final';
    const awayScore = typeof props.awayScore === 'number' ? props.awayScore : null;
    const homeScore = typeof props.homeScore === 'number' ? props.homeScore : null;

    let winnerId = null;
    if (isFinal && awayScore !== null && homeScore !== null) {
      winnerId = awayScore > homeScore ? awayTeam.id : homeTeam.id;
      if (winnerId === team1.id) team1.wins++;
      if (winnerId === team4.id) team4.wins++;
    }

    const gameEntry = {
      game: idx + 1,
      date: officialDate,
      away: awayTeam.name,
      home: homeTeam.name
    };
    if (isFinal) {
      gameEntry.awayScore = awayScore;
      gameEntry.homeScore = homeScore;
      gameEntry.winnerId = winnerId;
    }
    seriesAGames.push(gameEntry);
  });

  const seriesAComplete = team1.wins >= 2 || team4.wins >= 2;
  const seriesAWinnerId = team1.wins >= 2 ? team1.id : (team4.wins >= 2 ? team4.id : null);
  if (seriesAComplete) {
    team1.isWinner = (seriesAWinnerId === team1.id);
    team1.isEliminated = !team1.isWinner;
    team4.isWinner = (seriesAWinnerId === team4.id);
    team4.isEliminated = !team4.isWinner;
  }

  // --- Series B: #2 NY vs #3 LA (Best of 3) ---
  const team2 = { id: 4003, name: 'New York Heights', wins: 0, isWinner: false, isEliminated: false };
  const team3 = { id: 4002, name: 'Los Angeles Queens', wins: 0, isWinner: false, isEliminated: false };
  const seriesBGames = [];

  seriesBEvents.forEach((ev, idx) => {
    const props = ev.extendedProps || {};
    const { officialDate } = parseCdtDateTime(ev.start);
    const awayTeam = resolveWpblTeam(props.awayAbbr || props.awayTeam) || WPBL_TEAM_MAPPING['LA'];
    const homeTeam = resolveWpblTeam(props.homeAbbr || props.homeTeam) || WPBL_TEAM_MAPPING['NY'];
    const isFinal = (props.status || '').toLowerCase() === 'final';
    const awayScore = typeof props.awayScore === 'number' ? props.awayScore : null;
    const homeScore = typeof props.homeScore === 'number' ? props.homeScore : null;

    let winnerId = null;
    if (isFinal && awayScore !== null && homeScore !== null) {
      winnerId = awayScore > homeScore ? awayTeam.id : homeTeam.id;
      if (winnerId === team2.id) team2.wins++;
      if (winnerId === team3.id) team3.wins++;
    }

    const gameEntry = {
      game: idx + 1,
      date: officialDate,
      away: awayTeam.name,
      home: homeTeam.name
    };
    if (isFinal) {
      gameEntry.awayScore = awayScore;
      gameEntry.homeScore = homeScore;
      gameEntry.winnerId = winnerId;
    }
    seriesBGames.push(gameEntry);
  });

  const seriesBComplete = team2.wins >= 2 || team3.wins >= 2;
  const seriesBWinnerId = team2.wins >= 2 ? team2.id : (team3.wins >= 2 ? team3.id : null);
  if (seriesBComplete) {
    team2.isWinner = (seriesBWinnerId === team2.id);
    team2.isEliminated = !team2.isWinner;
    team3.isWinner = (seriesBWinnerId === team3.id);
    team3.isEliminated = !team3.isWinner;
  }

  // --- Championship: Series A Winner vs Series B Winner (Best of 5) ---
  const champTopTeam = seriesAWinnerId ? (seriesAWinnerId === team1.id ? team1 : team4) : team1;
  const champBottomTeam = seriesBWinnerId ? (seriesBWinnerId === team3.id ? team3 : team2) : team3;

  const teamTop = { id: champTopTeam.id, name: champTopTeam.name, wins: 0, isWinner: false, isEliminated: false };
  const teamBottom = { id: champBottomTeam.id, name: champBottomTeam.name, wins: 0, isWinner: false, isEliminated: false };
  const champGames = [];

  champEvents.forEach((ev, idx) => {
    const props = ev.extendedProps || {};
    const { officialDate } = parseCdtDateTime(ev.start);
    const isFinal = (props.status || '').toLowerCase() === 'final';
    const awayScore = typeof props.awayScore === 'number' ? props.awayScore : null;
    const homeScore = typeof props.homeScore === 'number' ? props.homeScore : null;

    let winnerId = null;
    if (isFinal && awayScore !== null && homeScore !== null) {
      const awayTeam = resolveWpblTeam(props.awayAbbr || props.awayTeam);
      const homeTeam = resolveWpblTeam(props.homeAbbr || props.homeTeam);
      winnerId = awayScore > homeScore ? awayTeam?.id : homeTeam?.id;
      if (winnerId === teamTop.id) teamTop.wins++;
      if (winnerId === teamBottom.id) teamBottom.wins++;
    }

    const gameEntry = {
      game: idx + 1,
      date: officialDate
    };
    if (idx >= 3) {
      gameEntry.ifNeeded = true;
    }
    if (isFinal) {
      gameEntry.awayScore = awayScore;
      gameEntry.homeScore = homeScore;
      gameEntry.winnerId = winnerId;
    }
    champGames.push(gameEntry);
  });

  const champComplete = teamTop.wins >= 3 || teamBottom.wins >= 3;
  const champWinnerId = teamTop.wins >= 3 ? teamTop.id : (teamBottom.wins >= 3 ? teamBottom.id : null);
  if (champComplete) {
    teamTop.isWinner = (champWinnerId === teamTop.id);
    teamTop.isEliminated = !teamTop.isWinner;
    teamBottom.isWinner = (champWinnerId === teamBottom.id);
    teamBottom.isEliminated = !teamBottom.isWinner;
  }

  const isStarted = seriesAGames.length > 0 || seriesBGames.length > 0;
  const isComplete = champComplete;

  return {
    '2026': {
      era: 'semifinals_championship',
      isStarted,
      isComplete,
      seeds,
      semifinalTop: {
        name: 'Series A',
        format: 'Best of 3',
        team1,
        team4,
        isStarted: seriesAGames.length > 0,
        isComplete: seriesAComplete,
        winnerId: seriesAWinnerId,
        games: seriesAGames
      },
      semifinalBottom: {
        name: 'Series B',
        format: 'Best of 3',
        team2,
        team3,
        isStarted: seriesBGames.length > 0,
        isComplete: seriesBComplete,
        winnerId: seriesBWinnerId,
        games: seriesBGames
      },
      championship: {
        name: 'WPBL Championship',
        format: 'Best of 5',
        teamTop,
        teamBottom,
        championId: champWinnerId,
        winnerId: champWinnerId,
        isStarted: champGames.some(g => g.winnerId !== undefined),
        isComplete: champComplete,
        games: champGames
      }
    }
  };
}

/**
 * Default fallback 2026 postseason data for offline execution.
 */
export function getDefault2026PostseasonData() {
  return {
    '2026': {
      era: 'semifinals_championship',
      isStarted: true,
      isComplete: false,
      seeds: {
        1: { id: 4004, name: 'San Francisco Firebells', shortName: 'Firebells' },
        2: { id: 4003, name: 'New York Heights', shortName: 'Heights' },
        3: { id: 4002, name: 'Los Angeles Queens', shortName: 'Queens' },
        4: { id: 4001, name: 'Boston Hunters', shortName: 'Hunters' }
      },
      semifinalTop: {
        name: 'Series A',
        format: 'Best of 3',
        team1: { id: 4004, name: 'San Francisco Firebells', wins: 2, isWinner: true, isEliminated: false },
        team4: { id: 4001, name: 'Boston Hunters', wins: 0, isWinner: false, isEliminated: true },
        isStarted: true,
        isComplete: true,
        winnerId: 4004,
        games: [
          { game: 1, date: '2026-09-09', away: 'Boston Hunters', awayScore: 4, home: 'San Francisco Firebells', homeScore: 6, winnerId: 4004 },
          { game: 2, date: '2026-09-11', away: 'San Francisco Firebells', awayScore: 9, home: 'Boston Hunters', homeScore: 6, winnerId: 4004 }
        ]
      },
      semifinalBottom: {
        name: 'Series B',
        format: 'Best of 3',
        team2: { id: 4003, name: 'New York Heights', wins: 1, isWinner: false, isEliminated: true },
        team3: { id: 4002, name: 'Los Angeles Queens', wins: 2, isWinner: true, isEliminated: false },
        isStarted: true,
        isComplete: true,
        winnerId: 4002,
        games: [
          { game: 1, date: '2026-09-10', away: 'Los Angeles Queens', awayScore: 10, home: 'New York Heights', homeScore: 3, winnerId: 4002 },
          { game: 2, date: '2026-09-12', away: 'New York Heights', awayScore: 9, home: 'Los Angeles Queens', homeScore: 7, winnerId: 4003 },
          { game: 3, date: '2026-09-14', away: 'Los Angeles Queens', awayScore: 15, home: 'New York Heights', homeScore: 11, winnerId: 4002 }
        ]
      },
      championship: {
        name: 'WPBL Championship',
        format: 'Best of 5',
        teamTop: { id: 4004, name: 'San Francisco Firebells', wins: 0, isWinner: false, isEliminated: false },
        teamBottom: { id: 4002, name: 'Los Angeles Queens', wins: 0, isWinner: false, isEliminated: false },
        championId: null,
        winnerId: null,
        isStarted: false,
        isComplete: false,
        games: [
          { game: 1, date: '2026-09-16' },
          { game: 2, date: '2026-09-17' },
          { game: 3, date: '2026-09-19' },
          { game: 4, date: '2026-09-20', ifNeeded: true },
          { game: 5, date: '2026-09-22', ifNeeded: true }
        ]
      }
    }
  };
}

/**
 * Generates the official 2026 inaugural WPBL regular season schedule and results.
 * Exactly 30 games total (15 games per club).
 * Standings outcome:
 * 1. SF:  10-5 (.667) - Pennant / #1 Seed
 * 2. NY:   8-7 (.533) - #2 Seed (won tiebreaker vs LA 3-2)
 * 3. LA:   8-7 (.533) - #3 Seed
 * 4. BOS:  4-11 (.267) - #4 Seed
 */
export function generateWpbl2026Schedule() {
  const teams = {
    BOS: WPBL_TEAM_MAPPING['BOS'],
    LA:  WPBL_TEAM_MAPPING['LA'],
    NY:  WPBL_TEAM_MAPPING['NY'],
    SF:  WPBL_TEAM_MAPPING['SF']
  };

  const schedule = [
    // Aug 1
    { date: '2026-08-01', time: '17:00', away: 'LA',  home: 'NY',  awayScore: 10, homeScore: 8 },
    // Aug 2
    { date: '2026-08-02', time: '18:30', away: 'SF',  home: 'BOS', awayScore: 11, homeScore: 3 },
    // Aug 5
    { date: '2026-08-05', time: '18:30', away: 'BOS', home: 'LA',  awayScore: 4,  homeScore: 12 },
    // Aug 6
    { date: '2026-08-06', time: '18:30', away: 'NY',  home: 'SF',  awayScore: 13, homeScore: 8 },
    // Aug 7
    { date: '2026-08-07', time: '18:30', away: 'SF',  home: 'LA',  awayScore: 3,  homeScore: 12 },
    // Aug 8
    { date: '2026-08-08', time: '13:00', away: 'BOS', home: 'NY',  awayScore: 9,  homeScore: 6 },
    { date: '2026-08-08', time: '18:30', away: 'LA',  home: 'SF',  awayScore: 3,  homeScore: 10 },
    // Aug 9
    { date: '2026-08-09', time: '18:30', away: 'NY',  home: 'BOS', awayScore: 7,  homeScore: 6 },
    // Aug 12
    { date: '2026-08-12', time: '18:30', away: 'LA',  home: 'SF',  awayScore: 2,  homeScore: 8 },
    // Aug 13
    { date: '2026-08-13', time: '18:30', away: 'BOS', home: 'NY',  awayScore: 6,  homeScore: 1 },
    // Aug 14
    { date: '2026-08-14', time: '18:30', away: 'LA',  home: 'SF',  awayScore: 3,  homeScore: 17 },
    // Aug 15
    { date: '2026-08-15', time: '13:00', away: 'SF',  home: 'NY',  awayScore: 11, homeScore: 6 },
    { date: '2026-08-15', time: '18:30', away: 'LA',  home: 'BOS', awayScore: 13, homeScore: 3 },
    // Aug 16
    { date: '2026-08-16', time: '18:30', away: 'BOS', home: 'NY',  awayScore: 9,  homeScore: 7 },
    // Aug 19
    { date: '2026-08-19', time: '18:30', away: 'NY',  home: 'SF',  awayScore: 11, homeScore: 8 },
    // Aug 20
    { date: '2026-08-20', time: '18:30', away: 'NY',  home: 'BOS', awayScore: 9,  homeScore: 4 },
    // Aug 21
    { date: '2026-08-21', time: '18:30', away: 'SF',  home: 'LA',  awayScore: 6,  homeScore: 8 },
    // Aug 22
    { date: '2026-08-22', time: '13:00', away: 'SF',  home: 'BOS', awayScore: 12, homeScore: 5 },
    { date: '2026-08-22', time: '18:30', away: 'NY',  home: 'LA',  awayScore: 8,  homeScore: 7 },
    // Aug 23
    { date: '2026-08-23', time: '18:30', away: 'LA',  home: 'BOS', awayScore: 3,  homeScore: 7 },
    // Aug 26
    { date: '2026-08-26', time: '18:30', away: 'BOS', home: 'LA',  awayScore: 6,  homeScore: 8 },
    // Aug 27
    { date: '2026-08-27', time: '18:30', away: 'LA',  home: 'NY',  awayScore: 4,  homeScore: 12 },
    // Aug 28
    { date: '2026-08-28', time: '18:30', away: 'BOS', home: 'SF',  awayScore: 6,  homeScore: 14 },
    // Aug 29
    { date: '2026-08-29', time: '18:30', away: 'NY',  home: 'LA',  awayScore: 6,  homeScore: 10 },
    // Aug 30
    { date: '2026-08-30', time: '18:30', away: 'NY',  home: 'SF',  awayScore: 9,  homeScore: 11 },
    // Sep 2
    { date: '2026-09-02', time: '18:30', away: 'SF',  home: 'BOS', awayScore: 8,  homeScore: 5 },
    // Sep 3
    { date: '2026-09-03', time: '18:30', away: 'NY',  home: 'LA',  awayScore: 18, homeScore: 7 },
    // Sep 4
    { date: '2026-09-04', time: '18:30', away: 'SF',  home: 'NY',  awayScore: 2,  homeScore: 14 },
    // Sep 5
    { date: '2026-09-05', time: '18:30', away: 'LA',  home: 'BOS', awayScore: 10, homeScore: 6 },
    // Sep 6
    { date: '2026-09-06', time: '18:30', away: 'BOS', home: 'SF',  awayScore: 7,  homeScore: 13 }
  ];

  return schedule.map((item, idx) => {
    const awayTeam = teams[item.away];
    const homeTeam = teams[item.home];
    const awayWinner = item.awayScore > item.homeScore;
    const homeWinner = item.homeScore > item.awayScore;
    const gameNumStr = String(idx + 1).padStart(3, '0');
    const gamePk = `${item.date.replace(/-/g, '')}04${gameNumStr}`;

    return {
      gamePk,
      season: 2026,
      league: 'WPBL',
      gameDate: `${item.date}T${item.time}:00-05:00`,
      officialDate: item.date,
      venue: {
        id: 4901,
        name: 'Robin Roberts Stadium',
        city: 'Springfield, IL'
      },
      status: {
        detailedState: 'Final',
        abstractGameState: 'F'
      },
      teams: {
        away: {
          team: {
            id: awayTeam.id,
            name: awayTeam.name,
            abbrev: awayTeam.abbrev,
            league: 'WPBL',
            division: 'WPBL'
          },
          score: item.awayScore,
          isWinner: awayWinner
        },
        home: {
          team: {
            id: homeTeam.id,
            name: homeTeam.name,
            abbrev: homeTeam.abbrev,
            league: 'WPBL',
            division: 'WPBL'
          },
          score: item.homeScore,
          isWinner: homeWinner
        }
      },
      isTie: false
    };
  });
}

/**
 * Scrapes live WPBL season & postseason data and writes to project directories.
 */
export async function scrapeWpblSeason(season = '2026', options = {}) {
  const sStr = String(season);
  console.log(`\n========================================`);
  console.log(`🥎 Processing WPBL Season: ${sStr}`);
  console.log(`========================================\n`);

  let games = [];
  let postseasonData = null;

  // Attempt live scrape from official website REST API
  if (!options.offline) {
    console.log(`📡 Fetching live calendar events from ${WPBL_CALENDAR_ENDPOINT}...`);
    const liveEvents = await fetchWpblCalendarEvents(WPBL_CALENDAR_ENDPOINT);
    if (liveEvents && liveEvents.length > 0) {
      console.log(`✅ Fetched ${liveEvents.length} live calendar events.`);
      const parsed = parseWpblEvents(liveEvents);
      games = parsed.regularSeasonGames;
      postseasonData = parsed.postseasonData;
    } else {
      console.log(`⚠️ Live fetch did not return events; using offline fallback schedule.`);
    }
  }

  // Fallback if offline or live fetch failed
  if (!games || games.length === 0) {
    games = generateWpbl2026Schedule();
  }
  if (!postseasonData) {
    postseasonData = getDefault2026PostseasonData();
  }

  // Final Standings Audit
  const recordCheck = {};
  games.forEach(g => {
    const aw = g.teams.away.team.abbrev;
    const hm = g.teams.home.team.abbrev;
    if (!recordCheck[aw]) recordCheck[aw] = { w: 0, l: 0, games: 0 };
    if (!recordCheck[hm]) recordCheck[hm] = { w: 0, l: 0, games: 0 };
    recordCheck[aw].games += 1;
    recordCheck[hm].games += 1;
    if (g.teams.away.isWinner) {
      recordCheck[aw].w += 1;
      recordCheck[hm].l += 1;
    } else {
      recordCheck[hm].w += 1;
      recordCheck[aw].l += 1;
    }
  });

  console.log('Final Regular Season Standings Audit:');
  Object.entries(recordCheck).forEach(([abbrev, rec]) => {
    const pct = (rec.w / (rec.w + rec.l)).toFixed(3);
    console.log(`  ${abbrev}: ${rec.w}-${rec.l} (${pct}) [${rec.games} games]`);
  });

  // Postseason Summary Audit
  const pData = postseasonData[sStr] || postseasonData['2026'];
  if (pData) {
    console.log('\nPostseason Summary Audit:');
    if (pData.semifinalTop) {
      console.log(`  Semi A: ${pData.semifinalTop.team1.name} (${pData.semifinalTop.team1.wins}) vs ${pData.semifinalTop.team4.name} (${pData.semifinalTop.team4.wins}) - Complete: ${pData.semifinalTop.isComplete}`);
    }
    if (pData.semifinalBottom) {
      console.log(`  Semi B: ${pData.semifinalBottom.team2.name} (${pData.semifinalBottom.team2.wins}) vs ${pData.semifinalBottom.team3.name} (${pData.semifinalBottom.team3.wins}) - Complete: ${pData.semifinalBottom.isComplete}`);
    }
    if (pData.championship) {
      console.log(`  Championship: ${pData.championship.teamTop.name} vs ${pData.championship.teamBottom.name} - Games scheduled: ${pData.championship.games?.length || 0}`);
    }
  }

  // Write Regular Season Dataset
  const serializedGames = JSON.stringify(games, null, 2);
  const gameTargets = [
    path.join(rootDir, 'data', 'wpbl', `${sStr}.json`)
  ];
  if (fs.existsSync(path.join(rootDir, 'public'))) {
    gameTargets.push(path.join(rootDir, 'public', 'data', 'wpbl', `${sStr}.json`));
  }
  if (fs.existsSync(path.join(rootDir, 'src'))) {
    gameTargets.push(path.join(rootDir, 'src', 'data', 'wpbl', `${sStr}.json`));
  }

  gameTargets.forEach(targetFile => {
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetFile, serializedGames, 'utf-8');
    console.log(`  💾 [Written] ${path.relative(rootDir, targetFile)} (${(serializedGames.length / 1024).toFixed(1)} KB)`);
  });

  // Write Regular Season Embedded JS
  if (fs.existsSync(path.join(rootDir, 'src'))) {
    const embeddedJsTarget = path.join(rootDir, 'src', 'data', 'wpbl', `${sStr}.js`);
    const jsContent = `/**
 * Embedded ${sStr} WPBL Schedule & Results Dataset
 * Enables zero-server local execution (file:/// protocol) without CORS restrictions.
 */
(function() {
  const games = ${serializedGames};
  if (typeof window !== "undefined") {
    window.WPBL_STATIC_DATA = window.WPBL_STATIC_DATA || {};
    window.WPBL_STATIC_DATA["${sStr}"] = games;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = games;
  }
})();
`;
    fs.writeFileSync(embeddedJsTarget, jsContent, 'utf-8');
    console.log(`  💾 [Written] ${path.relative(rootDir, embeddedJsTarget)} (${(jsContent.length / 1024).toFixed(1)} KB)`);
  }

  // Write Postseason Dataset
  const serializedPostseason = JSON.stringify(postseasonData, null, 2);
  const postseasonTargets = [
    path.join(rootDir, 'data', 'wpbl', 'postseason.json')
  ];
  if (fs.existsSync(path.join(rootDir, 'public'))) {
    postseasonTargets.push(path.join(rootDir, 'public', 'data', 'wpbl', 'postseason.json'));
  }
  if (fs.existsSync(path.join(rootDir, 'src'))) {
    postseasonTargets.push(path.join(rootDir, 'src', 'data', 'wpbl', 'postseason.json'));
  }

  postseasonTargets.forEach(targetFile => {
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetFile, serializedPostseason, 'utf-8');
    console.log(`  🏆 [Written] ${path.relative(rootDir, targetFile)} (${(serializedPostseason.length / 1024).toFixed(1)} KB)`);
  });

  // Write Postseason Embedded JS
  if (fs.existsSync(path.join(rootDir, 'src'))) {
    const embeddedPostseasonJsTarget = path.join(rootDir, 'src', 'data', 'wpbl', 'postseason.js');
    const psJsContent = `/**
 * Embedded WPBL Postseason Series Dataset
 * Enables zero-server local execution (file:/// protocol) without CORS restrictions.
 */
(function() {
  const postseason = ${serializedPostseason};
  if (typeof window !== "undefined") {
    window.WPBL_POSTSEASON_STATIC = postseason;
    if (window.postseasonSeriesData && window.postseasonSeriesData.POSTSEASON_SERIES_DATA) {
      window.postseasonSeriesData.POSTSEASON_SERIES_DATA.wpbl = postseason;
    }
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = postseason;
  }
})();
`;
    fs.writeFileSync(embeddedPostseasonJsTarget, psJsContent, 'utf-8');
    console.log(`  🏆 [Written] ${path.relative(rootDir, embeddedPostseasonJsTarget)} (${(psJsContent.length / 1024).toFixed(1)} KB)`);
  }

  // Update src/constants/postseasonSeriesData.js with synced postseason results if file exists
  updatePostseasonSeriesDataConstant(rootDir, postseasonData[sStr] || postseasonData['2026']);

  // Save scrape metadata with timestamp
  saveScrapeMetadata(rootDir, 'wpbl', season, games);

  return { games, postseasonData };
}

/**
 * Updates WPBL_POSTSEASON_DATA in src/constants/postseasonSeriesData.js with fresh results
 */
function updatePostseasonSeriesDataConstant(rootDir, wpbl2026Data) {
  if (!wpbl2026Data) return;
  const targetFile = path.join(rootDir, 'src', 'constants', 'postseasonSeriesData.js');
  if (!fs.existsSync(targetFile)) return;

  try {
    let content = fs.readFileSync(targetFile, 'utf-8');
    const wpblRegex = /(const\s+WPBL_POSTSEASON_DATA\s*=\s*{[\s\S]*?'2026':\s*){[\s\S]*?}(\s*};)/;
    if (wpblRegex.test(content)) {
      const indentedJson = JSON.stringify(wpbl2026Data, null, 6)
        .replace(/\n/g, '\n      ');
      content = content.replace(wpblRegex, `$1${indentedJson}$2`);
      fs.writeFileSync(targetFile, content, 'utf-8');
      console.log(`  🔄 [Updated] ${path.relative(rootDir, targetFile)} WPBL_POSTSEASON_DATA['2026']`);
    }
  } catch (err) {
    console.warn('  ⚠️ Could not update postseasonSeriesData.js:', err.message);
  }
}

/**
 * Writes data/<league>/metadata.json and updates src/constants/scrapeMeta.js if present
 */
function saveScrapeMetadata(rootDir, league, season, games) {
  const now = new Date();
  let ptString = '';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    const parts = formatter.formatToParts(now);
    const getP = t => parts.find(p => p.type === t)?.value || '';
    ptString = `${getP('year')}-${getP('month')}-${getP('day')} ${getP('hour')}:${getP('minute')} PT`;
  } catch (e) {
    ptString = now.toISOString();
  }

  const metaObj = {
    league,
    season: String(season),
    lastUpdated: now.toISOString(),
    lastUpdatedPT: ptString,
    lastScraped: now.toISOString(),
    lastScrapedPT: ptString,
    totalGames: Array.isArray(games) ? games.length : 0,
    completedGames: Array.isArray(games) ? games.filter(g => g.status?.detailedState === 'Final').length : 0
  };

  const serialized = JSON.stringify(metaObj, null, 2);
  const candidateDirs = [
    path.join(rootDir, 'public', 'data', league),
    path.join(rootDir, 'src', 'data', league),
    path.join(rootDir, 'data', league)
  ];

  candidateDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      const metaPath = path.join(dir, 'metadata.json');
      fs.writeFileSync(metaPath, serialized, 'utf-8');
      console.log(`  ⏱️ [Metadata] ${path.relative(rootDir, metaPath)} (${ptString})`);
    }
  });

  const scrapeMetaFile = path.join(rootDir, 'src', 'constants', 'scrapeMeta.js');
  if (fs.existsSync(scrapeMetaFile)) {
    try {
      let content = fs.readFileSync(scrapeMetaFile, 'utf-8');
      const lgRegex = new RegExp(`(${league}\\s*:\\s*{[\\s\\S]*?lastScraped:\\s*['"])([^'"]+)(['"])`);
      if (lgRegex.test(content)) {
        content = content.replace(lgRegex, `$1${ptString}$3`);
      }
      const isoRegex = new RegExp(`(${league}\\s*:\\s*{[\\s\\S]*?iso:\\s*['"])([^'"]+)(['"])`);
      if (isoRegex.test(content)) {
        content = content.replace(isoRegex, `$1${now.toISOString()}$3`);
      }
      fs.writeFileSync(scrapeMetaFile, content, 'utf-8');
    } catch (e) {}
  }
}

// CLI Execution entry point
if (process.argv[1] && process.argv[1].endsWith('scrapeWPBL.js')) {
  const args = process.argv.slice(2);
  let season = '2026';
  let offline = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--season' && args[i + 1]) {
      season = args[i + 1];
      i++;
    } else if (args[i] === '--offline') {
      offline = true;
    }
  }

  scrapeWpblSeason(season, { offline })
    .then(() => {
      console.log('\n✅ WPBL data generation complete.');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ WPBL generation failed:', err);
      process.exit(1);
    });
}
