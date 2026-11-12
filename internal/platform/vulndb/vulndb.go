// Package vulndb looks up known vulnerabilities for a product version, from
// public sources: NVD for the CVEs and their CVSS scores, CISA's Known
// Exploited Vulnerabilities catalogue for what attackers are using now, and
// FIRST's EPSS for how likely each is to be exploited soon.
package vulndb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
)

// Vuln is one known vulnerability that applies to a product version.
type Vuln struct {
	CVE       string  `json:"cve"`
	Severity  string  `json:"severity"` // critical, high, medium, low
	CVSS      float64 `json:"cvss"`
	KEV       bool    `json:"kev"`
	EPSS      float64 `json:"epss"`
	Summary   string  `json:"summary"`
	Published string  `json:"published,omitempty"`
	URL       string  `json:"url"`
}

const (
	nvdURL  = "https://services.nvd.nist.gov/rest/json/cves/2.0"
	kevURL  = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
	epssURL = "https://api.first.org/data/v1/epss"

	cacheFor  = 24 * time.Hour
	maxPerCPE = 200
)

// Client queries the sources, keeps answers for a day, and paces NVD calls
// within its public rate limit: 5 requests per 30 seconds without a key, 50
// with one.
type Client struct {
	HTTP   *http.Client
	APIKey string
	// Base URLs; tests point them at local servers.
	NVDURL, KEVURL, EPSSURL string

	mu       sync.Mutex
	cache    map[string]cached
	kev      map[string]bool
	kevAt    time.Time
	nextCall time.Time
}

type cached struct {
	vulns []Vuln
	at    time.Time
}

// New returns a client; apiKey may be empty.
func New(apiKey string) *Client {
	return &Client{HTTP: &http.Client{Timeout: 30 * time.Second}, APIKey: strings.TrimSpace(apiKey), NVDURL: nvdURL, KEVURL: kevURL, EPSSURL: epssURL}
}

// Lookup returns the known vulnerabilities for a CPE, worst first.
func (c *Client) Lookup(ctx context.Context, cpe string) ([]Vuln, error) {
	if cpe == "" {
		return nil, nil
	}
	c.mu.Lock()
	if c.cache == nil {
		c.cache = map[string]cached{}
	}
	if hit, ok := c.cache[cpe]; ok && time.Since(hit.at) < cacheFor {
		c.mu.Unlock()
		return hit.vulns, nil
	}
	c.mu.Unlock()

	vulns, err := c.fetchNVD(ctx, cpe)
	if err != nil {
		return nil, err
	}
	kev, _ := c.kevSet(ctx)
	ids := make([]string, 0, len(vulns))
	for i := range vulns {
		vulns[i].KEV = kev[vulns[i].CVE]
		ids = append(ids, vulns[i].CVE)
	}
	if scores, err := c.epss(ctx, ids); err == nil {
		for i := range vulns {
			vulns[i].EPSS = scores[vulns[i].CVE]
		}
	}
	for i := range vulns {
		vulns[i].Severity = rate(vulns[i])
	}
	SortVulns(vulns)

	c.mu.Lock()
	c.cache[cpe] = cached{vulns: vulns, at: time.Now()}
	c.mu.Unlock()
	return vulns, nil
}

// rate puts what attackers actually use ahead of raw CVSS.
func rate(v Vuln) string {
	switch {
	case v.KEV || v.CVSS >= 9:
		return "critical"
	case v.CVSS >= 7 || v.EPSS >= 0.1:
		return "high"
	case v.CVSS >= 4:
		return "medium"
	default:
		return "low"
	}
}

var severityRank = map[string]int{"critical": 0, "high": 1, "medium": 2, "low": 3}

// SortVulns orders vulnerabilities worst first: severity, then exploited,
// then CVSS.
func SortVulns(vs []Vuln) {
	slices.SortStableFunc(vs, func(a, b Vuln) int {
		if d := severityRank[a.Severity] - severityRank[b.Severity]; d != 0 {
			return d
		}
		if a.KEV != b.KEV {
			if a.KEV {
				return -1
			}
			return 1
		}
		switch {
		case a.CVSS > b.CVSS:
			return -1
		case a.CVSS < b.CVSS:
			return 1
		}
		return strings.Compare(b.CVE, a.CVE)
	})
}

// wait spaces NVD calls out to stay inside its rate limit.
func (c *Client) wait(ctx context.Context) error {
	gap := 6500 * time.Millisecond
	if c.APIKey != "" {
		gap = 650 * time.Millisecond
	}
	c.mu.Lock()
	now := time.Now()
	at := c.nextCall
	if at.Before(now) {
		at = now
	}
	c.nextCall = at.Add(gap)
	c.mu.Unlock()
	if d := time.Until(at); d > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(d):
		}
	}
	return nil
}

func (c *Client) get(ctx context.Context, rawURL string, nvd bool, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Qnetward-Vulnerabilities/1.0 (+https://qnetward.com)")
	if nvd && c.APIKey != "" {
		req.Header.Set("apiKey", c.APIKey)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s answered %d", req.URL.Host, resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 32<<20)).Decode(out)
}

type nvdResponse struct {
	Vulnerabilities []struct {
		CVE struct {
			ID           string `json:"id"`
			Published    string `json:"published"`
			VulnStatus   string `json:"vulnStatus"`
			Descriptions []struct {
				Lang  string `json:"lang"`
				Value string `json:"value"`
			} `json:"descriptions"`
			Metrics map[string][]struct {
				CVSSData struct {
					BaseScore float64 `json:"baseScore"`
				} `json:"cvssData"`
				Type string `json:"type"`
			} `json:"metrics"`
		} `json:"cve"`
	} `json:"vulnerabilities"`
}

func (c *Client) fetchNVD(ctx context.Context, cpe string) ([]Vuln, error) {
	if err := c.wait(ctx); err != nil {
		return nil, err
	}
	q := url.Values{}
	// virtualMatchString matches the version against each CVE's affected
	// version ranges, not only versions listed one by one.
	q.Set("virtualMatchString", cpe)
	q.Set("noRejected", "")
	q.Set("resultsPerPage", fmt.Sprint(maxPerCPE))
	var resp nvdResponse
	if err := c.get(ctx, c.NVDURL+"?"+strings.Replace(q.Encode(), "noRejected=", "noRejected", 1), true, &resp); err != nil {
		return nil, fmt.Errorf("vulnerability database: %w", err)
	}
	out := make([]Vuln, 0, len(resp.Vulnerabilities))
	for _, v := range resp.Vulnerabilities {
		if v.CVE.VulnStatus == "Rejected" {
			continue
		}
		vuln := Vuln{CVE: v.CVE.ID, Published: firstN(v.CVE.Published, 10), URL: "https://nvd.nist.gov/vuln/detail/" + v.CVE.ID}
		for _, d := range v.CVE.Descriptions {
			if d.Lang == "en" {
				vuln.Summary = firstN(d.Value, 400)
				break
			}
		}
		// Newest CVSS first; the primary score where there is one.
		for _, key := range []string{"cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"} {
			for _, m := range v.CVE.Metrics[key] {
				if m.CVSSData.BaseScore > vuln.CVSS || m.Type == "Primary" {
					vuln.CVSS = m.CVSSData.BaseScore
				}
			}
			if vuln.CVSS > 0 {
				break
			}
		}
		out = append(out, vuln)
	}
	return out, nil
}

func (c *Client) kevSet(ctx context.Context) (map[string]bool, error) {
	c.mu.Lock()
	if c.kev != nil && time.Since(c.kevAt) < cacheFor {
		k := c.kev
		c.mu.Unlock()
		return k, nil
	}
	c.mu.Unlock()
	var feed struct {
		Vulnerabilities []struct {
			CVEID string `json:"cveID"`
		} `json:"vulnerabilities"`
	}
	if err := c.get(ctx, c.KEVURL, false, &feed); err != nil {
		return nil, err
	}
	set := make(map[string]bool, len(feed.Vulnerabilities))
	for _, v := range feed.Vulnerabilities {
		set[v.CVEID] = true
	}
	c.mu.Lock()
	c.kev, c.kevAt = set, time.Now()
	c.mu.Unlock()
	return set, nil
}

func (c *Client) epss(ctx context.Context, ids []string) (map[string]float64, error) {
	out := map[string]float64{}
	for start := 0; start < len(ids); start += 100 {
		batch := ids[start:min(start+100, len(ids))]
		var resp struct {
			Data []struct {
				CVE  string `json:"cve"`
				EPSS string `json:"epss"`
			} `json:"data"`
		}
		if err := c.get(ctx, c.EPSSURL+"?cve="+url.QueryEscape(strings.Join(batch, ",")), false, &resp); err != nil {
			return out, err
		}
		for _, d := range resp.Data {
			var f float64
			if _, err := fmt.Sscan(d.EPSS, &f); err == nil {
				out[d.CVE] = f
			}
		}
	}
	return out, nil
}

func firstN(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// ErrUnavailable is returned when no source could be reached.
var ErrUnavailable = errors.New("vulnerability data is unavailable right now")
