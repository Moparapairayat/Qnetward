package store

import (
	"context"
	"fmt"
	"strings"

	"qnetward/internal/plans"
)

// What a plan allows runs; anything past it waits. A workspace that drops to
// a smaller plan (its paid period ended) keeps all its monitors, status pages,
// devices, and rules, but only the oldest ones up to the plan's limit run,
// are served, or are evaluated. Nothing is deleted or flagged, so paying again
// brings the rest back at once, and turning one off lets the next one in.

// planCapSQL is a SQL expression for a plan's limit on one resource, written
// from the plan catalog so the database and the Go code agree. planExpr is the
// plan column, such as "w.plan". Unknown plans get Free's limit, as plans.For
// does.
func planCapSQL(planExpr string, pick func(plans.Limits) int) string {
	var b strings.Builder
	fmt.Fprintf(&b, "CASE lower(trim(%s))", planExpr)
	for _, id := range plans.IDs {
		if id != plans.Free {
			fmt.Fprintf(&b, " WHEN '%s' THEN %d", id, pick(plans.For(id).Limits))
		}
	}
	fmt.Fprintf(&b, " ELSE %d END", pick(plans.For(plans.Free).Limits))
	return b.String()
}

// withinPlanSQL is a condition, "<idExpr> IN (...)", true for rows of table that
// are active and among the first the workspace's plan allows, oldest first.
// It reads workspaces, so it is for queries run as the server, not inside a
// workspace transaction.
func withinPlanSQL(idExpr, table, active string, pick func(plans.Limits) int) string {
	return fmt.Sprintf(`%s IN (
		SELECT ranked.id FROM (
			SELECT t.id, ROW_NUMBER() OVER (PARTITION BY t.workspace_id ORDER BY t.id) AS rn, %s AS cap
			FROM %s t JOIN workspaces w ON w.id = t.workspace_id
			WHERE %s
		) ranked WHERE ranked.rn <= ranked.cap)`, idExpr, planCapSQL("w.plan", pick), table, active)
}

func monitorCap(l plans.Limits) int    { return l.Monitors }
func statusPageCap(l plans.Limits) int { return l.StatusPages }
func hostRuleCap(l plans.Limits) int   { return l.HostAlertRules }

// WorkspacePlan returns the plan stored on a workspace.
func (s *Store) WorkspacePlan(ctx context.Context, workspaceID int64) (plans.Plan, error) {
	if s == nil {
		return plans.For(""), nil
	}
	var plan string
	if err := s.db.QueryRowContext(ctx, `SELECT plan FROM workspaces WHERE id = $1`, workspaceID).Scan(&plan); err != nil {
		return plans.Plan{}, err
	}
	return plans.For(plan), nil
}
