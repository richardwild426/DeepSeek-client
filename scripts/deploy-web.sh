#!/bin/sh
# 重新打包 Web 静态站并发布到 ds.zvector.top。
# 用法: scripts/deploy-web.sh
set -eu
cd "$(dirname "$0")/.."

OUT=".nsh/out/web-dist"
echo "== 打包 =="
nsh package --target web --out "$OUT"

test -f "$OUT/砚台/index.html" || { echo "缺少 $OUT/砚台/index.html" >&2; exit 1; }

echo "== 发布 =="
npx --yes wrangler@latest deploy

echo "== 验证 =="
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://ds.zvector.top/)
echo "https://ds.zvector.top/ -> $code"
[ "$code" = "200" ] || exit 1
