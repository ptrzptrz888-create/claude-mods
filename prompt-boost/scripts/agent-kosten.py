"""Measures what subagents cost, before and since "Sparsame Agenten".

Reads ~/.claude/projects/*/*/subagents/*.jsonl (one transcript per subagent)
and the agentType from the *.meta.json beside each. A transcript counts for
the moment its first row was written, the agent's start: a file written
again later (a resumed or touched transcript) keeps its place.

    python3 -I agent-kosten.py --since 2026-10-08T12:00:00.000Z [--days 28]
"""

import argparse
import datetime as dt
import glob
import json
import os
import statistics

TARGET_START = 30_000
TARGET_DROP = 0.40
TOP_TYPES = 6


def context_of(usage):
    return (
        usage.get("input_tokens", 0)
        + usage.get("cache_creation_input_tokens", 0)
        + usage.get("cache_read_input_tokens", 0)
    )


def read_agent(path):
    """Start time, first request's context, rounds and summed input of one transcript."""
    first, total, cached, rounds, started = None, 0, 0, 0, None
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            stamp = row.get("timestamp")
            if isinstance(stamp, str) and (started is None or stamp < started):
                started = stamp
            message = row.get("message")
            if row.get("type") != "assistant" or not isinstance(message, dict):
                continue
            usage = message.get("usage")
            if not isinstance(usage, dict):
                continue
            context = context_of(usage)
            first = context if first is None else first
            total += context
            cached += usage.get("cache_read_input_tokens", 0)
            rounds += 1
    if first is None or started is None:
        return None
    agent_type = "?"
    meta = path[: -len(".jsonl")] + ".meta.json"
    if os.path.exists(meta):
        try:
            with open(meta, encoding="utf-8") as handle:
                agent_type = json.load(handle).get("agentType", "?")
        except (OSError, ValueError):
            pass
    started_at = dt.datetime.fromisoformat(started.replace("Z", "+00:00")).timestamp()
    return {"start": first, "rounds": rounds, "total": total, "cached": cached, "type": agent_type, "started_at": started_at}


def tokens(value):
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}".replace(".", ",") + " Mio."
    if value >= 1_000:
        return f"{round(value / 1_000)}k"
    return str(round(value))


def medians(agents):
    shares = [a["cached"] / a["total"] for a in agents if a["total"]]
    return {
        "start": statistics.median(a["start"] for a in agents),
        "rounds": statistics.median(a["rounds"] for a in agents),
        "total": statistics.median(a["total"] for a in agents),
        "cached": statistics.median(shares) if shares else 0,
    }


def row(label, agents):
    if not agents:
        return f"| {label} | 0 | – | – | – | – |"
    m = medians(agents)
    return (
        f"| {label} | {len(agents)} | {tokens(m['start'])} | {round(m['rounds'])} "
        f"| {tokens(m['total'])} | {round(100 * m['cached'])} % |"
    )


def verdict(before, after):
    if not before or not after:
        return "Noch zu wenig Läufe für einen Vergleich."
    b, a = medians(before), medians(after)
    checks = [
        ("Start unter 30k", a["start"] < TARGET_START),
        ("Runden mindestens 40 % weniger", a["rounds"] <= b["rounds"] * (1 - TARGET_DROP)),
        ("Summe mindestens 40 % weniger", a["total"] <= b["total"] * (1 - TARGET_DROP)),
    ]
    return "Ziele: " + " · ".join(f"{name} {'erreicht' if ok else 'offen'}" for name, ok in checks)


HEADER = ["| Zeitraum | Agenten | Start | Runden | Summe Input | aus Cache |", "|---|---|---|---|---|---|"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", required=True, help="ISO-Zeitpunkt, ab dem die Mod lief")
    parser.add_argument("--days", type=int, default=28, help="wie weit vor --since verglichen wird")
    args = parser.parse_args()

    since = dt.datetime.fromisoformat(args.since.replace("Z", "+00:00")).timestamp()
    oldest = since - args.days * 86_400
    pattern = os.path.expanduser("~/.claude/projects/*/*/subagents/*.jsonl")
    before, after = [], []
    for path in glob.glob(pattern):
        # A file is never written before its agent started: the write time
        # only rules out what is too old, the start time decides the side.
        if os.path.getmtime(path) < oldest:
            continue
        agent = read_agent(path)
        if agent is None or agent["started_at"] < oldest:
            continue
        (after if agent["started_at"] >= since else before).append(agent)

    lines = [
        f"Subagenten-Kosten (Median je Agent, nach Startzeitpunkt), Grenze {args.since[:16].replace('T', ' ')} UTC",
        "",
        *HEADER,
        row(f"{args.days} Tage vorher", before),
        row("seit Sparsame Agenten", after),
        "",
        verdict(before, after),
    ]
    if after:
        by_type = {}
        for agent in after:
            by_type.setdefault(agent["type"], []).append(agent)
        ranked = sorted(by_type.items(), key=lambda item: -len(item[1]))[:TOP_TYPES]
        lines += ["", "Seitdem nach Typ:", "", *HEADER]
        lines += [row(name, agents) for name, agents in ranked]
    print("\n".join(lines))


if __name__ == "__main__":
    main()
