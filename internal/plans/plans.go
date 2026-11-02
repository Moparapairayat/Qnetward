// Package plans defines what each workspace plan includes and the limits that
// keep one tenant from crowding out the others.
package plans

import "strings"

// Limits are per workspace. Hourly and per-minute rates are counted per API
// process; see ADR 0014.
type Limits struct {
	Monitors             int `json:"monitors"`
	APIKeys              int `json:"api_keys"`
	Members              int `json:"members"`
	ProbesPerHour        int `json:"probes_per_hour"`
	ScansPerHour         int `json:"scans_per_hour"`
	APIRequestsPerMinute int `json:"api_requests_per_minute"`
}

type Plan struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Limits Limits `json:"limits"`
}

const (
	Free       = "free"
	Pro        = "pro"
	Enterprise = "enterprise"
)

var catalog = map[string]Plan{
	Free: {ID: Free, Name: "Free", Limits: Limits{
		Monitors: 20, APIKeys: 10, Members: 25,
		ProbesPerHour: 600, ScansPerHour: 30, APIRequestsPerMinute: 120,
	}},
	Pro: {ID: Pro, Name: "Pro", Limits: Limits{
		Monitors: 200, APIKeys: 50, Members: 100,
		ProbesPerHour: 3000, ScansPerHour: 200, APIRequestsPerMinute: 600,
	}},
	Enterprise: {ID: Enterprise, Name: "Enterprise", Limits: Limits{
		Monitors: 2000, APIKeys: 200, Members: 1000,
		ProbesPerHour: 20000, ScansPerHour: 1000, APIRequestsPerMinute: 3000,
	}},
}

// IDs lists the plans in upgrade order.
var IDs = []string{Free, Pro, Enterprise}

// For returns the plan stored on a workspace. Workspaces created before
// plans existed say "starter", which is the free plan; anything unknown is
// treated as free too, so a typo can never grant more.
func For(stored string) Plan {
	if p, ok := catalog[strings.ToLower(strings.TrimSpace(stored))]; ok {
		return p
	}
	return catalog[Free]
}

// Valid reports whether id names a plan.
func Valid(id string) bool {
	_, ok := catalog[id]
	return ok
}
