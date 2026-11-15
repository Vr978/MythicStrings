#!/usr/bin/env bash
set -euo pipefail
umask 027
exec 9>/run/mythic-install.lock
flock 9

bucket="$1"
artifact_key="$2"
env_key="$3"
table="$4"
region="$5"
release="$(basename "$artifact_key" .tgz)"
release_dir="/opt/mythic/releases/$release"

if ! command -v node-22 >/dev/null 2>&1; then
  dnf install -y nodejs22 nodejs22-npm
fi
id mythic >/dev/null 2>&1 || useradd --system --home-dir /var/lib/mythic --shell /sbin/nologin mythic
install -d -m 755 /opt/mythic /opt/mythic/releases
install -d -m 750 -o mythic -g mythic /var/lib/mythic
install -d -m 750 -o root -g mythic /etc/mythic
mkdir -p "$release_dir"
aws s3 cp "s3://$bucket/$artifact_key" /tmp/mythic-release.tgz --region "$region" --only-show-errors
tar -xzf /tmp/mythic-release.tgz -C "$release_dir"
rm /tmp/mythic-release.tgz
test -f "$release_dir/dist/server/index.cjs"
test -f "$release_dir/dist/client/index.html"
chmod -R a+rX "$release_dir"

aws s3 cp "s3://$bucket/$env_key" /etc/mythic/env.next --region "$region" --only-show-errors
cat >> /etc/mythic/env.next <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
DATA_DIR=/var/lib/mythic
STATIC_DIR=dist/client
AWS_REGION=$region
DYNAMODB_TABLE=$table
TRUST_PROXY=true
EOF
chown root:mythic /etc/mythic/env.next
chmod 640 /etc/mythic/env.next
mv -f /etc/mythic/env.next /etc/mythic/env
ln -sfn "$release_dir" /opt/mythic/current.next
mv -Tf /opt/mythic/current.next /opt/mythic/current

cat > /etc/systemd/system/mythic.service <<'UNIT'
[Unit]
Description=Mythic Strings authoritative duel server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mythic
Group=mythic
WorkingDirectory=/opt/mythic/current
EnvironmentFile=/etc/mythic/env
ExecStart=/usr/bin/node-22 dist/server/index.cjs
Restart=on-failure
RestartSec=3
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/mythic
UMask=0077
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable mythic
systemctl restart mythic

for attempt in $(seq 1 30); do
  if /usr/bin/node-22 --env-file=/etc/mythic/env -e 'fetch("http://127.0.0.1:8787/api/health",{headers:{"x-mythic-origin":process.env.ORIGIN_SECRET||""}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'; then
    echo "Mythic Strings is healthy on the origin."
    exit 0
  fi
  sleep 2
done
echo "The server did not become healthy. Inspect: journalctl -u mythic -n 80" >&2
exit 1
