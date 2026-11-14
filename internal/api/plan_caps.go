package api

import "sort"

// overPlan reports, for each of n items, whether the plan leaves it waiting:
// the oldest active items (by ID) up to limit run, the active ones after them
// don't, and inactive ones are never over. It matches the database's rule in
// store/plan_caps.go, so lists say exactly what runs.
func overPlan(n int, item func(i int) (id int64, active bool), limit int) []bool {
	over := make([]bool, n)
	var active []int
	for i := 0; i < n; i++ {
		if _, on := item(i); on {
			active = append(active, i)
		}
	}
	sort.Slice(active, func(a, b int) bool {
		ia, _ := item(active[a])
		ib, _ := item(active[b])
		return ia < ib
	})
	for rank, i := range active {
		over[i] = rank >= limit
	}
	return over
}
