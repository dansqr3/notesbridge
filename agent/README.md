# apple-notes-agent

The Mac-side half of **NotesBridge** — it lets ChatGPT and Claude read and write your
**Apple Notes**. This tiny agent runs on your Mac, connects to the NotesBridge relay,
and does the actual talking to the Notes app (via macOS automation). Your notes never
leave your machine except for the specific request you make.

- No account, no password, no cloud copy of your notes.
- One command to pair, one command to keep it running forever.
- No dependencies — just Node 18+.

---

## Quick start

You need [Node.js 18 or newer](https://nodejs.org). Then:

```sh
# 1. Clone NotesBridge and open a terminal in its agent/ folder.
# 2. On the NotesBridge site, generate a pairing code, then pair this Mac:
node cli.mjs pair ABCD-1234 --server https://YOUR-APP.vercel.app

# 3. Keep it running in the background — starts on login, restarts if it crashes:
node cli.mjs install
```

That's it. You can close the terminal — the agent keeps running.

> **First run permission prompt:** the first time the agent touches Apple Notes,
> macOS shows a one-time prompt asking to allow automation of "Notes". Click **OK**.
> If you miss it, enable it later under
> **System Settings → Privacy & Security → Automation**.

### Optional: install the checkout globally

From this `agent/` directory, install the local package globally if you want the
`apple-notes-agent` command available from any folder:

```sh
npm install -g .
apple-notes-agent pair ABCD-1234
apple-notes-agent install
```

---

## Commands

| Command | What it does |
|---|---|
| `apple-notes-agent pair <CODE>` | Claim a pairing code and save the agent token to `~/.notesbridge-agent.json` (mode 600). |
| `apple-notes-agent install` | Install a macOS LaunchAgent so the agent auto-starts on login and restarts on crash. |
| `apple-notes-agent run` | Run the agent in the foreground (Ctrl-C to stop). `install` does this for you in the background. |
| `apple-notes-agent status` | Check that you're paired, the server is reachable, and whether auto-start is installed. |
| `apple-notes-agent logs` | Show the last ~50 lines of the background agent log. |
| `apple-notes-agent uninstall` | Stop and remove the background agent (LaunchAgent). |
| `apple-notes-agent --version` | Print the version. |
| `apple-notes-agent --help` | Show usage. |

All commands accept `--server <URL>` to point at a different relay
(default: `https://notesbridge-server-prod-gorod.vercel.app`).

---

## How it works

```
ChatGPT / Claude  ──MCP──▶  NotesBridge on Vercel
                                  ▲
                                  │ fixed agent API relay
                           Supabase Edge Function
                                  ▲
                                  │
                       apple-notes-agent (your Mac)
                                  │
                                  ▼
                           Apple Notes (JXA)
```

The agent uses the project's Supabase Edge Function for only four fixed transport
routes (`pair/claim`, `agent/ping`, `agent/poll`, and `agent/result`). The function
forwards those calls to the production Vercel API; Vercel still validates pairing
codes, agent JWTs, revocation, and job ownership. It is not an arbitrary URL proxy,
and no Supabase API key is embedded in the Mac agent. The agent then runs each job
against Apple Notes using Apple's JavaScript automation (JXA / `osascript`) and
posts the result back. When there's nothing to do it long-polls for up to 25 seconds.

The Supabase Free quota includes 500,000 Edge Function invocations per month. One
Mac polling every 25 seconds uses about 104,000 invocations per 30-day month, before
pairing and status checks.

- Config/token: `~/.notesbridge-agent.json` (permissions `600`).
- Background logs: `~/Library/Logs/notesbridge-agent.log` and `notesbridge-agent.err.log`.
- LaunchAgent: `~/Library/LaunchAgents/com.notesbridge.apple-notes-agent.plist`.

---

## Troubleshooting

**"Not paired" / it stopped working after a while.**
Your pairing token may have been revoked. Re-pair and reinstall:

```sh
apple-notes-agent pair <NEW-CODE>
apple-notes-agent install
```

If the background agent hit a `401`, it writes `~/.notesbridge-agent.unauthorized`
and keeps the reason in the error log — check `apple-notes-agent logs`.

**Notes aren't being read/written.**
Make sure the Notes app is allowed under
**System Settings → Privacy & Security → Automation** (allow your terminal / `node`
to control **Notes**). Then `apple-notes-agent uninstall` and `install` again.

**Check what's happening.**

```sh
apple-notes-agent status   # paired? reachable? auto-start installed?
apple-notes-agent logs     # recent activity + errors
```

**Uninstall completely.**

```sh
apple-notes-agent uninstall
rm ~/.notesbridge-agent.json   # also forget the pairing token
```

**Non-macOS.** `install`/`uninstall`/`logs` are macOS-only (they use LaunchAgents).
`pair`, `run`, and `status` work anywhere Node runs, but the Notes automation itself
requires macOS.

---

## Privacy

The agent only contacts the relay server you paired with. It sends the result of the
specific note operation you (via ChatGPT/Claude) requested — nothing else. Your notes
are not uploaded or indexed anywhere.

## License

MIT © Isaiah Dupree

## Private local indexing

From this repository's root with Node.js 22.13 or later, run
`node agent/cli.mjs index` to index the actual Apple Notes text in batches of 25.
`node agent/cli.mjs index-status` reports counts without displaying note contents.
`node agent/cli.mjs index-install`
builds the index and installs a bounded incremental refresh every 15 minutes.
The index is stored with owner-only permissions under
`~/Library/Application Support/NotesBridge/notes-index.sqlite`, outside Git.
Password-protected content is excluded; attachments are not indexed.

The running agent uses the index for keyword search only after checking its
IDs, titles, folders, timestamps and lock flags against the current Notes
library. If the library changed or the optional SQLite runtime is unavailable,
search uses the live Notes implementation. Existing Node.js 18+ relay use
continues to work without indexing.
These commands have not yet been published to npm.
