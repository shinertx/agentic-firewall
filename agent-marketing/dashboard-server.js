const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const BASE = __dirname;

function safeRead(file) {
    try {
        return JSON.parse(fs.readFileSync(path.join(BASE, file), 'utf8'));
    } catch { return []; }
}

function safeReadText(file) {
    try {
        return fs.readFileSync(path.join(BASE, file), 'utf8');
    } catch { return ''; }
}

function getLogStats(logFile) {
    try {
        const log = fs.readFileSync(path.join(BASE, logFile), 'utf8');
        const lines = log.split('\n').filter(Boolean);
        const lastLines = lines.slice(-200);
        const cycleMatch = log.match(/=== Cycle (\d+) Complete/g);
        const lastCycle = cycleMatch ? parseInt(cycleMatch[cycleMatch.length - 1].match(/\d+/)[0]) : 0;
        const failures = (log.match(/ERROR/g) || []).length;
        const successPosts = (log.match(/Successfully posted/g) || []).length;
        const lastActivity = lines.filter(l => l.includes(' - jenni.')).pop() || '';
        return { lastCycle, failures, successPosts, lastActivity, recentLogs: lastLines.slice(-30) };
    } catch { return { lastCycle: 0, failures: 0, successPosts: 0, lastActivity: '', recentLogs: [] }; }
}

function getPm2Status() {
    try {
        const out = execSync('pm2 jlist 2>/dev/null', { timeout: 3000 }).toString();
        return JSON.parse(out);
    } catch { return []; }
}

function getTmuxStatus() {
    try {
        const out = execSync('tmux ls 2>/dev/null', { timeout: 3000 }).toString();
        return out.trim();
    } catch { return 'No sessions'; }
}

app.get('/api/status', (req, res) => {
    const redditLeads = safeRead('data/leads.json');
    const youtubeLeads = safeRead('data/leads_youtube.json');
    const drafts = safeRead('data/draft_replies.json');
    const logStats = getLogStats('logs/orchestrator.log');
    const pm2 = getPm2Status();
    const tmux = getTmuxStatus();

    const countByStatus = (arr) => {
        const counts = {};
        arr.forEach(l => { counts[l.status || 'unknown'] = (counts[l.status || 'unknown'] || 0) + 1; });
        return counts;
    };

    res.json({
        timestamp: new Date().toISOString(),
        swarm: {
            cycle: logStats.lastCycle,
            pending: drafts.length,
            posted: 0,
            failed: 0,
            lastUpdated: new Date().toISOString(),
            isRunning: tmux.includes('firewall-swarm'),
        },
        platforms: {
            reddit: {
                name: 'Reddit',
                icon: '🟠',
                total: redditLeads.length,
                byStatus: countByStatus(redditLeads),
                health: 'ok',
                healthMsg: 'Scouting developer subreddits via RSS',
                postingEnabled: false,
            },
            youtube: {
                name: 'YouTube',
                icon: '🔴',
                total: youtubeLeads.length,
                byStatus: countByStatus(youtubeLeads),
                health: 'ok',
                healthMsg: 'Scouting developer tutorial videos & comments',
                postingEnabled: false,
            }
        },
        drafts: {
            total: drafts.length,
            pending: drafts.filter(d => d.status === 'draft').length,
        },
        processes: {
            pm2: pm2.filter(p => p.name.includes('firewall')).map(p => ({
                name: p.name,
                status: p.pm2_env?.status,
                cpu: p.monit?.cpu,
                memory: Math.round((p.monit?.memory || 0) / 1024 / 1024),
                restarts: p.pm2_env?.restart_time,
            })),
            tmux: tmux,
        },
        recentLogs: logStats.recentLogs,
    });
});

app.get('/api/leads/:platform', (req, res) => {
    const map = {
        reddit: 'data/leads.json',
        youtube: 'data/leads_youtube.json',
    };
    const file = map[req.params.platform];
    if (!file) return res.status(404).json({ error: 'Unknown platform' });
    const leads = safeRead(file);
    const page = parseInt(req.query.page || '0');
    const limit = 20;
    res.json({
        total: leads.length,
        page,
        leads: leads.slice(page * limit, (page + 1) * limit),
    });
});

const PORT = 4243;
app.listen(PORT, () => console.log(`Agent Firewall Marketing Dashboard running on http://localhost:${PORT}`));
