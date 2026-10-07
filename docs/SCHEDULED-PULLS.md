# Pulling on a schedule, and why it is installed switched off

The dashboard already complains when its figures go stale — there is a freshness
policy and an alert for breaching it. Until now nothing made them fresh: all
three pulls were commands somebody typed. This installs the schedule that does,
and leaves it off.

```bash
sudo /opt/gtg/Acc/deploy/install-pull-timer.sh
```

That puts a systemd service and timer in place, writes
`/opt/gtg/pull-secrets.env` from the example at mode 600, and enables nothing.

## Why off

**Mango allows one session per account.** It serves an
`API/Public/KickUserOnline` endpoint, which is what a system with that rule
has, and the evidence is first-hand: a pull failed, with no explanation
anywhere, immediately after somebody was asked to look at a figure in Mango's
own screen with the same account.

So a schedule started before there is a service account would sign an employee
out of Mango every morning, and their signing in would break the pull in
return — intermittently, with nothing on either side saying why. That is a
worse failure than no schedule at all, because it looks like flakiness rather
than a rule.

**Getting the service account is therefore the first task, not a tidy-up.** It
was already wanted for the audit trail — Mango logs every menu a user opens, and
machine traffic under a person's name makes their audit trail unanswerable — but
that was a reason to prefer one. This is a reason to require one.

## Three gates

Being disabled is not the only thing standing in front of the work, because
"disabled" is one `systemctl enable` away from not being.

| | What it is | Why |
|---|---|---|
| the timer | not enabled by the installer | the ordinary switch |
| `GTG_PULL_ENABLED` | must be `1` in the secrets file | so a timer enabled by accident, or by somebody tidying up, does nothing |
| `MANGO_IS_SERVICE_ACCOUNT` | must be `yes` | an acknowledgement that the account is not a person's. Nothing can check it; the run refuses without it |

A fourth thing is not a gate but has the same shape: a `flock`, so two runs
cannot overlap. Two pulls at once would turn each other's Mango session off, for
exactly the reason above.

## Turning it on, in order

1. **A service account for Mango**, with read rights to every project and every
   company that has to be reported. Not an employee's login.
2. Fill in `/opt/gtg/pull-secrets.env`, and in it set
   `MANGO_IS_SERVICE_ACCOUNT=yes` and `GTG_PULL_ENABLED=1`.
3. Run it by hand once — it is safe, and `--dry-run` is the default in the
   example file, so it reports what it would do and writes nothing:
   ```bash
   sudo /opt/gtg/Acc/deploy/pull-all.sh
   ```
4. Drop `--dry-run` from the `*_PULL_ARGS` lines, with `--company` or
   `--all-companies --map …` as appropriate, and run it by hand again.
5. Then start the timer:
   ```bash
   sudo systemctl enable --now gtg-pull.timer
   systemctl list-timers gtg-pull.timer
   ```

## When it runs

06:00 Bangkok, which is 23:00 UTC the day before on a VM that keeps UTC, plus a
random delay of up to fifteen minutes. `Persistent=yes`, so a machine that was
down at the hour pulls when it comes back rather than skipping a day quietly.

Logs go to `/var/log/gtg-pull/`, one file per run, deleted after thirty days by
the run itself rather than by a second timer somebody has to know about. A run
where anything configured failed exits non-zero, so `systemctl status
gtg-pull.service` says so — a morning where nothing arrived should not also be a
morning where nothing complained.

## The accounting pull does not fit on this machine

The Mango RE and Booking pulls are plain HTTP and cost almost nothing. The
accounting pull drives a browser, and a browser wants around 600 MB.

The VM is an `e2-micro`: one gigabyte in total, already running the application
with a 320 MB heap cap for the same reason. So rather than discover that at six
in the morning as an out-of-memory kill, the run measures what is available
first and skips the browser pull with a reason — and records it as a failure, so
it is not mistaken for having run.

Three ways out, in the order they are worth considering:

1. **Ask Mango for the API token** — see [`MANGO-API-REQUEST.md`](MANGO-API-REQUEST.md).
   A browser holding a session open is a reasonable way to reach figures nobody
   can otherwise reach; it is not a reasonable thing to depend on daily, and the
   memory is only the most visible part of that.
2. Run that one pull from a machine with room, writing to the same database.
3. Grow the VM. The cheapest real fix, and the least interesting.

## What the secrets file holds

`/opt/gtg/pull-secrets.env`, mode 600, read by `pull-all.sh` and by nothing
else. It is **not** passed to the container, so these never appear in `docker
inspect` or in the image — which is the same reason the administrator secret
lives in a file rather than in `docker-compose.yml`.

It is not in the repository and must not be. `deploy/pull-secrets.env.example`
is, and holds placeholders the pulls refuse to run with.
