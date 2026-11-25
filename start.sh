#!/usr/bin/env bash
# Local development: start the existing PostgreSQL service, then NocoBase.
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$project_dir"

if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help)
      printf '用法：%s\n启动本地 PostgreSQL 和 NocoBase 开发服务。\n按 Ctrl+C 停止应用；数据库保留运行及数据。\n' "$0"
      exit 0
      ;;
    *)
      printf '不支持的参数。使用 ./start.sh --help 查看用法。\n' >&2
      exit 2
      ;;
  esac
fi

fail() {
  printf '启动失败：%s\n' "$1" >&2
  exit 1
}

for command_name in node npx docker; do
  command -v "$command_name" >/dev/null 2>&1 || fail "未找到 $command_name，请先安装。"
done
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || fail '需要 Node.js 24 或更高版本。'

pnpm_spec="$(node -p 'require("./package.json").packageManager')"
[[ "$pnpm_spec" == pnpm@* ]] || fail 'package.json 未声明 pnpm 版本。'
[[ -x node_modules/.bin/nocobase ]] || fail "项目依赖尚未安装，请先运行 npx --yes $pnpm_spec install。"
[[ -r config.yml ]] || fail '缺少 config.yml，请先恢复本项目的本机配置。'
[[ -r storage/local/postgres-admin-password ]] || fail '缺少 PostgreSQL 本机密钥文件，请先恢复 storage/local/postgres-admin-password。'

docker compose version >/dev/null 2>&1 || fail '需要 Docker Compose v2。'
docker info >/dev/null 2>&1 || fail 'Docker 未运行或当前用户没有访问权限。'

printf '启动 PostgreSQL，等待数据库就绪……\n'
docker compose -p nocoerp-app -f "$project_dir/compose.postgres.yml" up -d --wait --wait-timeout 60 postgres

printf '\n启动 NocoBase（%s，不更改全局 pnpm 版本）。\n' "$pnpm_spec"
printf '请打开启动输出中的 Local: 地址。按 Ctrl+C 停止应用，数据库继续运行。\n\n'
exec npx --yes "$pnpm_spec" dev
