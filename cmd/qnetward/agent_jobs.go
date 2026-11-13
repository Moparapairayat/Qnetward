package main

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"qnetward/internal/engine/httpcheck"
	"qnetward/internal/engine/ping"
	"qnetward/internal/engine/report"
	"qnetward/internal/engine/tcpping"
	"qnetward/internal/probe"
)

// The same check shape the server uses, so results from an agent and from
// the server mean the same thing.
const (
	agentProbeCount    = 3
	agentProbeInterval = 500 * time.Millisecond
	agentProbeTimeout  = 2 * time.Second
	agentHTTPTimeout   = 10 * time.Second
	agentCheckTimeout  = 30 * time.Second
	agentConcurrency   = 8
	// agentResultsBuffer caps results kept while the console is unreachable.
	agentResultsBuffer = 500
)

// agentJob is a monitor the console asked this agent to check.
type agentJob struct {
	MonitorID       int64  `json:"monitor_id"`
	Protocol        string `json:"protocol"`
	Target          string `json:"target"`
	Port            *int   `json:"port,omitempty"`
	IntervalSeconds int    `json:"interval_seconds"`
	ExpectedStatus  *int   `json:"expected_status,omitempty"`
}

func (j agentJob) same(o agentJob) bool {
	return j.Protocol == o.Protocol && j.Target == o.Target && intEq(j.Port, o.Port) &&
		j.IntervalSeconds == o.IntervalSeconds && intEq(j.ExpectedStatus, o.ExpectedStatus)
}

func intEq(a, b *int) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// agentResult is one finished check, as the console takes it.
type agentResult struct {
	MonitorID    int64      `json:"monitor_id"`
	CheckedAt    time.Time  `json:"checked_at"`
	OK           bool       `json:"ok"`
	RttMs        *float64   `json:"rtt_ms,omitempty"`
	LossPercent  float64    `json:"loss_percent"`
	StatusCode   *int       `json:"status_code,omitempty"`
	Error        string     `json:"error,omitempty"`
	TLSExpiresAt *time.Time `json:"tls_expires_at,omitempty"`
	// Samples are the individual pings or connects, for History and alert rules.
	Samples []agentSample `json:"samples,omitempty"`
}

// agentSample is one ping or TCP connect within a check.
type agentSample struct {
	Seq   int      `json:"seq"`
	RttMs *float64 `json:"rtt_ms,omitempty"`
	Error string   `json:"error,omitempty"`
	Addr  string   `json:"addr,omitempty"`
}

type scheduledJob struct {
	job     agentJob
	next    time.Time
	running bool
}

// jobRunner keeps the agent's monitors on their intervals and collects
// results until they are sent.
type jobRunner struct {
	mu      sync.Mutex
	jobs    map[int64]*scheduledJob
	results []agentResult
	slots   chan struct{}
	check   func(context.Context, agentJob) agentResult
}

func newJobRunner() *jobRunner {
	return &jobRunner{jobs: map[int64]*scheduledJob{}, slots: make(chan struct{}, agentConcurrency), check: runAgentJob}
}

// sync replaces the job list with the console's. New or changed jobs run at once.
func (r *jobRunner) sync(jobs []agentJob) {
	r.mu.Lock()
	defer r.mu.Unlock()
	keep := make(map[int64]bool, len(jobs))
	for _, j := range jobs {
		keep[j.MonitorID] = true
		if cur, ok := r.jobs[j.MonitorID]; ok && cur.job.same(j) {
			continue
		}
		r.jobs[j.MonitorID] = &scheduledJob{job: j, next: time.Now()}
	}
	for id := range r.jobs {
		if !keep[id] {
			delete(r.jobs, id)
		}
	}
}

func (r *jobRunner) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.jobs)
}

// runNow makes a monitor due at once, for "Run now" in the console.
func (r *jobRunner) runNow(monitorID int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	sj, ok := r.jobs[monitorID]
	if !ok {
		return false
	}
	sj.next = time.Now()
	return true
}

// startDue starts every job whose time has come, as slots allow.
func (r *jobRunner) startDue(ctx context.Context, wg *sync.WaitGroup) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	for _, sj := range r.jobs {
		if sj.running || now.Before(sj.next) {
			continue
		}
		select {
		case r.slots <- struct{}{}:
		default:
			return
		}
		sj.running = true
		sj.next = now.Add(time.Duration(max(sj.job.IntervalSeconds, 30)) * time.Second)
		wg.Add(1)
		go func(sj *scheduledJob, job agentJob) {
			defer wg.Done()
			defer func() { <-r.slots }()
			res := r.check(ctx, job)
			r.mu.Lock()
			defer r.mu.Unlock()
			sj.running = false
			if ctx.Err() != nil {
				return
			}
			r.results = append(r.results, res)
			if over := len(r.results) - agentResultsBuffer; over > 0 {
				r.results = r.results[over:]
			}
		}(sj, sj.job)
	}
}

// take removes up to n results for sending.
func (r *jobRunner) take(n int) []agentResult {
	r.mu.Lock()
	defer r.mu.Unlock()
	n = min(n, len(r.results))
	out := append([]agentResult(nil), r.results[:n]...)
	r.results = r.results[n:]
	return out
}

// putBack returns results that couldn't be sent, ahead of newer ones.
func (r *jobRunner) putBack(rs []agentResult) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.results = append(rs, r.results...)
	if over := len(r.results) - agentResultsBuffer; over > 0 {
		r.results = r.results[over:]
	}
}

// runAgentJob runs one check. Unlike the server, an agent may reach private
// addresses: checking the network it sits in is what it's for.
func runAgentJob(ctx context.Context, job agentJob) agentResult {
	ctx, cancel := context.WithTimeout(ctx, agentCheckTimeout)
	defer cancel()
	res := agentResult{MonitorID: job.MonitorID, LossPercent: 100}

	if job.Protocol == "http" {
		out, err := httpcheck.Run(ctx, job.Target, httpcheck.Config{Timeout: agentHTTPTimeout})
		res.CheckedAt = time.Now().UTC()
		if err != nil {
			res.Error = err.Error()
			return res
		}
		code := out.StatusCode
		ms := float64(out.Duration) / float64(time.Millisecond)
		res.StatusCode, res.RttMs, res.TLSExpiresAt = &code, &ms, out.TLSExpiresAt
		switch {
		case job.ExpectedStatus != nil && code == *job.ExpectedStatus,
			job.ExpectedStatus == nil && code >= 200 && code < 400:
			res.OK, res.LossPercent = true, 0
		case job.ExpectedStatus != nil:
			res.Error = fmt.Sprintf("returned %d, expected %d", code, *job.ExpectedStatus)
		default:
			res.Error = fmt.Sprintf("returned %d %s", code, http.StatusText(code))
		}
		return res
	}

	var rep report.Report
	var err error
	switch job.Protocol {
	case "ping":
		var cfg ping.Config
		if cfg, err = probe.NormalizePingConfig(agentProbeCount, agentProbeInterval, agentProbeTimeout, 0, false, false); err == nil {
			rep, err = ping.RunContext(ctx, job.Target, cfg)
		}
	case "tcpping":
		port := 0
		if job.Port != nil {
			port = *job.Port
		}
		var cfg tcpping.Config
		if _, _, cfg, err = probe.NormalizeTCPPingRequest(job.Target, port, agentProbeCount, agentProbeInterval, agentProbeTimeout, false); err == nil {
			rep, err = tcpping.RunContext(ctx, job.Target, port, cfg)
		}
	default:
		err = fmt.Errorf("this agent can't run %q checks; update it", job.Protocol)
	}
	res.CheckedAt = time.Now().UTC()
	for _, r := range rep.Results {
		s := agentSample{Seq: r.Seq, Error: r.Error, Addr: r.Addr}
		if r.Error == "" {
			ms := float64(r.RTT) / float64(time.Millisecond)
			s.RttMs = &ms
		}
		res.Samples = append(res.Samples, s)
	}
	switch {
	case err != nil:
		res.Error = err.Error()
	case rep.Summary.Recv == 0:
		res.Error = "no replies"
		for _, r := range rep.Results {
			if r.Error != "" {
				res.Error = r.Error
				break
			}
		}
	default:
		res.OK = true
		res.LossPercent = rep.Summary.Loss
		avg := float64(rep.Summary.Avg) / float64(time.Millisecond)
		res.RttMs = &avg
	}
	return res
}
