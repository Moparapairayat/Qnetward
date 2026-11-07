package plans

import "testing"

func TestForMapsStoredValues(t *testing.T) {
	cases := map[string]string{"": Free, "starter": Free, "FREE": Free, "pro": Pro, " enterprise ": Enterprise, "platinum": Free}
	for stored, want := range cases {
		if got := For(stored).ID; got != want {
			t.Errorf("For(%q) = %q, want %q", stored, got, want)
		}
	}
}

func TestHigherPlansNeverLimitMore(t *testing.T) {
	for i := 1; i < len(IDs); i++ {
		lower, higher := For(IDs[i-1]).Limits, For(IDs[i]).Limits
		if higher.Monitors < lower.Monitors || higher.APIKeys < lower.APIKeys || higher.Members < lower.Members ||
			higher.ProbesPerHour < lower.ProbesPerHour || higher.ScansPerHour < lower.ScansPerHour ||
			higher.APIRequestsPerMinute < lower.APIRequestsPerMinute || higher.StatusPages < lower.StatusPages {
			t.Errorf("%s limits fall below %s", IDs[i], IDs[i-1])
		}
	}
}
