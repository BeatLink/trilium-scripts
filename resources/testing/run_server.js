#!/usr/bin/env node
"use strict";
/* Start/stop the standalone trilium-server test instance.

Usage:
    node resources/testing/run_server.js start [--real]
    node resources/testing/run_server.js stop

`trilium-server` must already be on PATH -- provided by this repo's flake
devShell (`nix develop`), not installed separately. Data lives in
resources/testing/data/ by default (override with TRILIUM_TESTING_DATA_DIR).

Runs with TRILIUM_INTEGRATION_TEST=memory by default: the server loads
data/document.db into an in-memory copy on boot, so nothing that happens
during a test run ever touches the file on disk -- the golden seed snapshot
built by seed.js can't be corrupted by a test. Pass --real to run against the
file for real (writes persist); only seed.js itself should need this.
*/

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = process.env.TRILIUM_TESTING_DATA_DIR ||
    path.join(REPO_ROOT, "resources", "testing", "data");
const PORT = parseInt(process.env.TRILIUM_TESTING_PORT || "8090", 10);
const PIDFILE = path.join(path.dirname(DATA_DIR), ".server.pid");
const LOGFILE = path.join(path.dirname(DATA_DIR), "server.log");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRunning() {
    if (!fs.existsSync(PIDFILE)) return null;
    let pid;
    try {
        pid = parseInt(fs.readFileSync(PIDFILE, "utf8").trim(), 10);
    } catch {
        return null;
    }
    if (Number.isNaN(pid)) return null;
    try {
        process.kill(pid, 0);
    } catch {
        return null;
    }
    return pid;
}

function which(cmd) {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim().split("\n")[0] : null;
}

function ping(url) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: 1000 }, (res) => {
            res.resume();
            resolve(true);
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => { req.destroy(); resolve(false); });
    });
}

async function start(real = false) {
    const running = isRunning();
    if (running) {
        console.log(`Already running (pid ${running})`);
        return;
    }

    if (!fs.existsSync(DATA_DIR)) {
        console.error(`No data dir at ${DATA_DIR} -- run trilium_seed first`);
        process.exit(1);
    }

    if (which("trilium-server") === null) {
        console.error("trilium-server not on PATH -- run inside `nix develop`");
        process.exit(1);
    }

    const env = { ...process.env };
    env.TRILIUM_DATA_DIR = DATA_DIR;
    env.TRILIUM_NETWORK_PORT = String(PORT);
    if (!real) env.TRILIUM_INTEGRATION_TEST = "memory";

    const log = fs.openSync(LOGFILE, "w");
    const proc = spawn("trilium-server", [], { env, stdio: ["ignore", log, log], detached: true });
    proc.unref();
    fs.writeFileSync(PIDFILE, String(proc.pid));

    const url = `http://127.0.0.1:${PORT}/`;
    for (let i = 0; i < 60; i++) {
        if (await ping(url)) {
            console.log(`Server ready at ${url} (pid ${proc.pid})`);
            return;
        }
        await sleep(1000);
    }
    console.error(`Server didn't come up in time -- check ${LOGFILE}`);
    process.exit(1);
}

async function stop() {
    const pid = isRunning();
    if (!pid) {
        console.log("Not running");
        fs.rmSync(PIDFILE, { force: true });
        return;
    }
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 10; i++) {
        try {
            process.kill(pid, 0);
            await sleep(500);
        } catch {
            break;
        }
    }
    fs.rmSync(PIDFILE, { force: true });
    console.log("Stopped");
}

module.exports = { start, stop, isRunning, DATA_DIR, PORT, PIDFILE, LOGFILE };

if (require.main === module) {
    const cmd = process.argv[2];
    const real = process.argv.includes("--real");
    if (cmd === "start") {
        start(real);
    } else if (cmd === "stop") {
        stop();
    } else {
        process.stderr.write(
            "Usage:\n" +
            "    node resources/testing/run_server.js start [--real]\n" +
            "    node resources/testing/run_server.js stop\n"
        );
        process.exit(1);
    }
}
