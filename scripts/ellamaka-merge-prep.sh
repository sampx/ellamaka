#!/bin/bash
set -euo pipefail
# ellamaka-merge-prep.sh — Prepare for merging a new upstream opencode version
#
# Usage:
#   ./scripts/ellamaka-merge-prep.sh <target-tag>
#   ./scripts/ellamaka-merge-prep.sh --from <base-tag> <target-tag>
#
# Produces a 4-section report:
#   1. Upstream delta (new, modified, deleted files)
#   2. Ellamaka modifications vs upstream
#   3. Merge simulation (conflict prediction via git merge-tree)
#   4. Slim-down gap analysis (new upstream dirs vs check-cleanup.sh)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Colors ──────────────────────────────────────────────────────────
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
BOLD='\033[1m'
NC='\033[0m'

usage() {
  cat <<EOF
Usage: $(basename "$0") [--from <commit>] <target-tag>

Prepare for merging a new upstream opencode release into ellamaka.
Base is auto-computed as git merge-base of HEAD and target-tag.

Arguments:
  target-tag    The upstream tag to merge (e.g., v1.17.3)

Options:
  --from <commit>  Override merge-base commit (default: git merge-base HEAD <target>)
  --json        Output machine-readable JSON format
  -h, --help    Show this help

Examples:
  $(basename "$0") v1.17.3              Auto-compute merge-base, prepare for v1.17.3
  $(basename "$0") --from abc123 v1.17.3  Explicit merge-base commit
EOF
  exit 0
}

# ── Parse arguments ──────────────────────────────────────────────────
MERGE_BASE_OVERRIDE=""
TARGET_TAG=""
JSON_MODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --from) MERGE_BASE_OVERRIDE="$2"; shift 2 ;;
    --json) JSON_MODE=true; shift ;;
    *) TARGET_TAG="$1"; shift ;;
  esac
done

if [[ -z "$TARGET_TAG" ]]; then
  echo -e "${RED}Error:${NC} target tag is required"
  usage
fi

cd "$PROJECT_ROOT"

# ── Validate target tag ──────────────────────────────────────────────
if ! git rev-parse --verify "$TARGET_TAG^{commit}" &>/dev/null; then
  echo -e "${RED}Error:${NC} tag '$TARGET_TAG' not found locally."
  echo "  Fetch upstream tags first: git fetch upstream --tags"
  exit 1
fi

# ── Compute merge base ───────────────────────────────────────────────
if [[ -z "$MERGE_BASE_OVERRIDE" ]]; then
  MERGE_BASE=$(git merge-base HEAD "$TARGET_TAG" 2>/dev/null || true)
  if [[ -z "$MERGE_BASE" ]]; then
    echo -e "${RED}Error:${NC} no common ancestor between HEAD and $TARGET_TAG"
    exit 1
  fi
else
  MERGE_BASE="$MERGE_BASE_OVERRIDE"
fi

HEAD_SHORT=$(git rev-parse --short HEAD)
HEAD_SUBJECT=$(git log --oneline -1 --format='%s' HEAD | cut -c1-50)
MERGE_BASE_SHORT=$(git rev-parse --short "$MERGE_BASE")

# ── Collect data (all relative to MERGE_BASE) ────────────────────────

# Upstream delta stats
UP_ADDED=$(git diff "$MERGE_BASE".."$TARGET_TAG" --diff-filter=A --name-only | wc -l | tr -d ' ')
UP_MODIFIED=$(git diff "$MERGE_BASE".."$TARGET_TAG" --diff-filter=M --name-only | wc -l | tr -d ' ')
UP_DELETED=$(git diff "$MERGE_BASE".."$TARGET_TAG" --diff-filter=D --name-only | wc -l | tr -d ' ')
UP_RENAMED=$(git diff "$MERGE_BASE".."$TARGET_TAG" --diff-filter=R --name-only | wc -l | tr -d ' ')
UP_SRC_MODIFIED=$(git diff "$MERGE_BASE".."$TARGET_TAG" --diff-filter=M --name-only -- packages/opencode/src/ packages/core/src/ | sort -u)

# Ellamaka modifications
EL_MODIFIED=$(git diff "$MERGE_BASE"..HEAD --diff-filter=M --name-only -- packages/opencode/src/ packages/core/src/ | sort -u)

# New upstream packages (directory-level comparison)
TARGET_PKGS=$(git ls-tree -d --name-only "$TARGET_TAG":packages/ 2>/dev/null | sort)
BASE_PKGS=$(git ls-tree -d --name-only "$MERGE_BASE":packages/ 2>/dev/null | sort)
UP_NEW_PKGS=$(comm -13 <(echo "$BASE_PKGS") <(echo "$TARGET_PKGS") || true)

# New top-level directories
TARGET_TOP=$(git ls-tree -d --name-only "$TARGET_TAG": 2>/dev/null | sort)
BASE_TOP=$(git ls-tree -d --name-only "$MERGE_BASE": 2>/dev/null | sort)
UP_NEW_TOPLEVEL=$(comm -13 <(echo "$BASE_TOP") <(echo "$TARGET_TOP") || true)

# Merge simulation
MERGE_TREE_OUTPUT=$(git merge-tree "$MERGE_BASE" HEAD "$TARGET_TAG" 2>&1) || true

CONFLICTED=$(echo "$MERGE_TREE_OUTPUT" | grep -A3 '^changed in both' | grep 'our ' | awk '{print $NF}' | sort -u || true)
CONFLICT_COUNT=$(echo "$CONFLICTED" | grep -c . || echo 0)
CLEAN_MERGED=$(echo "$MERGE_TREE_OUTPUT" | grep -cE '^merged' || echo 0)
REMOVED_LOCAL=$(echo "$MERGE_TREE_OUTPUT" | grep -cE '^removed in local' || echo 0)
ADDED_REMOTE=$(echo "$MERGE_TREE_OUTPUT" | grep -cE '^added in remote' || echo 0)

# Slim-down parsing
CLEANUP_FILE="$PROJECT_ROOT/scripts/check-cleanup.sh"
CLEANUP_PATHS=$(grep -E '^\s+"' "$CLEANUP_FILE" | sed 's/^[[:space:]]*"//' | sed 's/".*$//' || true)

GAPS=""
for pkg in $UP_NEW_PKGS; do
  [[ -z "$pkg" ]] && continue
  in_list=false
  pkg_path="packages/$pkg"
  for path in $CLEANUP_PATHS; do
    path_clean="${path%/}"
    if [[ "$pkg_path" == "$path_clean" ]] || [[ "$pkg" == "$path_clean" ]]; then
      in_list=true
      break
    fi
  done
  if ! $in_list; then
    GAPS="$GAPS $pkg"
  fi
done
GAPS=$(echo "$GAPS" | xargs -n1 2>/dev/null | sort -u || true)

# ── JSON mode ────────────────────────────────────────────────────────
if $JSON_MODE; then
  echo "{"
  echo "  \"merge_base\": \"$MERGE_BASE\","
  echo "  \"target_tag\": \"$TARGET_TAG\","
  echo "  \"upstream_delta\": {"
  echo "    \"added\": $UP_ADDED,"
  echo "    \"modified\": $UP_MODIFIED,"
  echo "    \"deleted\": $UP_DELETED,"
  echo "    \"renamed\": $UP_RENAMED"
  echo "  },"
  echo "  \"upstream_new_dirs\": [$(echo "$UP_NEW_PKGS" | xargs -I{} echo -n "\"packages/{}\", " 2>/dev/null | sed 's/, $//')],"
  echo "  \"conflicted_files\": [$(echo "$CONFLICTED" | xargs -I{} echo -n "\"{}\", " 2>/dev/null | sed 's/, $//')],"
  echo "  \"conflict_count\": $CONFLICT_COUNT,"
  echo "  \"slim_down_gaps\": [$(echo "$GAPS" | xargs -I{} echo -n "\"packages/{}\", " 2>/dev/null | sed 's/, $//')]"
  echo "}"
  exit 0
fi

# ── Print report ─────────────────────────────────────────────────────
print_header() {
  echo ""
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║  ${BOLD}Ellamaka Merge Preparation Report${NC}                           ║"
  echo "╠══════════════════════════════════════════════════════════════════╣"
  printf "║  %-12s %-51s ║\n" "Merge-Base:" "$MERGE_BASE_SHORT"
  printf "║  %-12s %-51s ║\n" "Target:" "$TARGET_TAG"
  printf "║  %-12s %-51s ║\n" "HEAD:" "$HEAD_SHORT ($HEAD_SUBJECT)"
  echo "╚══════════════════════════════════════════════════════════════════╝"
}

print_header

# ── Report 1: Upstream Delta ─────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ 1. Upstream Delta ($MERGE_BASE → $TARGET_TAG) ━━━${NC}"
echo ""

if [[ -n "$UP_NEW_PKGS" ]]; then
  echo -e "${CYAN}New packages (upstream additions):${NC}"
  echo "$UP_NEW_PKGS" | while read pkg; do
    [[ -n "$pkg" ]] && echo "  + packages/$pkg/"
  done
fi

if [[ -n "$UP_NEW_TOPLEVEL" ]]; then
  echo -e "${CYAN}New top-level directories:${NC}"
  echo "$UP_NEW_TOPLEVEL" | while read d; do
    [[ -n "$d" ]] && echo "  + $d/"
  done
fi

echo ""
echo -e "File stats: ${GREEN}+${UP_ADDED} added${NC}  ${YELLOW}~${UP_MODIFIED} modified${NC}  ${RED}-${UP_DELETED} deleted${NC}  ↔${UP_RENAMED} renamed"

UP_SRC_COUNT=$(echo "$UP_SRC_MODIFIED" | wc -l | tr -d ' ')
echo ""
echo -e "${YELLOW}Upstream-modified source files ($UP_SRC_COUNT total — potential conflict sources):${NC}"
echo "$UP_SRC_MODIFIED" | head -20 | while read f; do
  echo "  M  $f"
done
if [[ $UP_SRC_COUNT -gt 20 ]]; then
  echo "  ... and $((UP_SRC_COUNT - 20)) more"
fi

# ── Report 2: Ellamaka Modifications ─────────────────────────────────
echo ""
echo -e "${BOLD}━━━ 2. Ellamaka Customizations ($MERGE_BASE → HEAD) ━━━${NC}"
echo ""

EL_COUNT=$(echo "$EL_MODIFIED" | wc -l | tr -d ' ')
echo -e "${CYAN}Modified upstream source files ($EL_COUNT total):${NC}"
echo "$EL_MODIFIED" | head -20 | while read f; do
  echo "  M  $f"
done
if [[ $EL_COUNT -gt 20 ]]; then
  echo "  ... and $((EL_COUNT - 20)) more"
fi

echo ""
echo -e "${GREEN}New ellamaka-only additions:${NC}"
echo "  A  packages/ellamaka/"
echo "  A  scripts/"
echo "  A  docs/BRANDING.md, DESIGN.md, UPSTREAM-MERGE-LOG.md"
echo "  A  .github/workflows/publish-ellamaka.yml"

# Classify conflicts: ellamaka real changes vs upstream carry-over
ELLAMAKA_MODIFIED_FILES=$(mktemp)
git log --first-parent --no-merges --name-only --pretty="" "$MERGE_BASE"..HEAD 2>/dev/null | sort -u > "$ELLAMAKA_MODIFIED_FILES"

OUR_CONFLICTS=""
UPSTREAM_CONFLICTS=""
for f in $CONFLICTED; do
  if grep -qxF "$f" "$ELLAMAKA_MODIFIED_FILES" 2>/dev/null; then
    OUR_CONFLICTS="$OUR_CONFLICTS
$f"
  else
    UPSTREAM_CONFLICTS="$UPSTREAM_CONFLICTS
$f"
  fi
done
rm -f "$ELLAMAKA_MODIFIED_FILES"

OUR_COUNT=$(echo "$OUR_CONFLICTS" | grep -c . 2>/dev/null || echo 0)
UP_COUNT=$(echo "$UPSTREAM_CONFLICTS" | grep -c . 2>/dev/null || echo 0)

# ── Report 3: Merge Simulation ───────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ 3. Merge Simulation (git merge-tree) ━━━${NC}"
echo ""
echo -e "Clean merged:    ${GREEN}${CLEAN_MERGED}${NC} files"
echo -e "Added in remote: ${CYAN}${ADDED_REMOTE}${NC} files (new from upstream)"
echo -e "Removed locally: ${YELLOW}${REMOVED_LOCAL}${NC} files (slim-down deletions)"

echo ""
if [[ $OUR_COUNT -gt 0 ]]; then
  echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
  printf "${RED}${BOLD}║  REAL CONFLICTS: %-2s files (ellamaka changed these)        ║${NC}\n" "$OUR_COUNT"
  echo -e "${RED}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
  echo -e "${RED}${BOLD}║  Must manually resolve — protect ellamaka customizations ║${NC}"
  echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "$OUR_CONFLICTS" | grep . | sort | while read f; do
    echo -e "  ${RED}⚠${NC}  $f"
  done
else
  echo -e "${GREEN}No real conflicts. All ellamaka customizations merge cleanly.${NC}"
fi

if [[ $UP_COUNT -gt 0 ]]; then
  echo ""
  echo -e "${YELLOW}╔══════════════════════════════════════════════════════════╗${NC}"
  printf "${YELLOW}║  UPSTREAM DIVERGENCE: %-2s files (no ellamaka changes)     ║${NC}\n" "$UP_COUNT"
  echo -e "${YELLOW}╠══════════════════════════════════════════════════════════╣${NC}"
  echo -e "${YELLOW}║  These files differ because merge-base is before the     ║${NC}"
  echo -e "${YELLOW}║  last merge. Both versions are upstream's — take theirs. ║${NC}"
  echo -e "${YELLOW}╚══════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "$UPSTREAM_CONFLICTS" | grep . | sort | while read f; do
    echo -e "  ${YELLOW}→${NC}  $f   (take theirs)"
  done
fi

# ── Report 4: Slim-Down Gap ─────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ 4. Slim-Down Gap Analysis ━━━${NC}"
echo ""

if [[ -n "$GAPS" ]]; then
  echo -e "${YELLOW}New upstream packages NOT in check-cleanup.sh:${NC}"
  echo "$GAPS" | while read pkg; do
    [[ -n "$pkg" ]] && echo -e "  ${YELLOW}⚠${NC} packages/$pkg/  ← evaluate for slim-down"
  done
  echo ""
  echo "  Action: add unneeded packages to scripts/check-cleanup.sh CLEANUP_PATHS array."
else
  echo -e "${GREEN}✓ All new upstream directories covered by check-cleanup.sh${NC}"
fi

# ── Self-consistency check ──────────────────────────────────────────
# Verify that report numbers are internally consistent
# Rule: OUR + UPSTREAM = total conflicts from merge-tree
TOTAL_CLASSIFIED=$((OUR_COUNT + UP_COUNT))
if [[ $TOTAL_CLASSIFIED -ne $CONFLICT_COUNT ]]; then
  echo ""
  echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}${BOLD}║  INTERNAL ERROR: conflict classification mismatch      ║${NC}"
  echo -e "${RED}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
  printf "${RED}${BOLD}║  OUR (%s) + UPSTREAM (%s) ≠ TOTAL (%s)%*s║${NC}\n" "$OUR_COUNT" "$UP_COUNT" "$CONFLICT_COUNT" $((40 - ${#OUR_COUNT} - ${#UP_COUNT} - ${#CONFLICT_COUNT} - 27)) ""
  echo -e "${RED}${BOLD}║  Report this as a bug in ellamaka-merge-prep.sh        ║${NC}"
  echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
  exit 3
fi

# Rule: conflict files should ALL appear in either ellamaka commits or merge-tree
# (indirect check — if upstream files were misclassified, the user sees wrong guidance)

# ── Footer ───────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════════"
echo -e "${BOLD}Recommended workflow:${NC}"
echo "  1. Study REAL CONFLICTS above — each file has ellamaka customizations to protect"
echo "  2. For UPSTREAM DIVERGENCE files, take theirs during merge"
echo "  3. If slim-down gaps exist, update check-cleanup.sh first"
echo "  4. Run:  git merge $TARGET_TAG"
echo "  5. Resolve only the REAL CONFLICT files, favoring ellamaka's version"
echo "  6. Run:  ./scripts/check-cleanup.sh       (check for upstream artifacts)"
echo "  7. Run:  ./scripts/check-cleanup.sh --clean (remove them)"
echo "  8. Run:  bun typecheck && bun test          (verify)"
echo "  9. Commit the merge"
echo "══════════════════════════════════════════════════════════════════"
