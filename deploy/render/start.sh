#!/bin/sh
# Starts the API, the console, and nginx in one container. If any of them
# exits, the container exits too, so Render restarts the whole thing.
set -eu

PORT="${PORT:-10000}"
sed "s/__PORT__/${PORT}/" /app/nginx.conf.template > /tmp/nginx.conf

/app/qnetward serve &
api=$!

(cd /app/web && PORT=3000 HOSTNAME=127.0.0.1 node server.js) &
web=$!

nginx -c /tmp/nginx.conf -g 'daemon off;' &
proxy=$!

stop() {
	kill "$api" "$web" "$proxy" 2>/dev/null || true
}
trap stop INT TERM

# Wait for the first one to stop, then take the others down with it.
while kill -0 "$api" 2>/dev/null && kill -0 "$web" 2>/dev/null && kill -0 "$proxy" 2>/dev/null; do
	sleep 2
done
echo "a process exited; stopping the container" >&2
stop
exit 1
