package main

import (
	"context"
	"testing"
	"time"
)

// The collector reads real numbers from this machine, and rates appear from
// the second sample on.
func TestHostCollectorSample(t *testing.T) {
	ctx := context.Background()
	c := newHostCollector()
	now := time.Now()
	first := c.sample(ctx, now)
	if first.MemTotal == 0 || first.MemUsed > first.MemTotal || first.CPU < 0 || first.CPU > 100 || first.Uptime == 0 {
		t.Fatalf("first sample: %+v", first)
	}
	if len(first.Disks) == 0 || first.Disks[0].Total == 0 {
		t.Fatalf("at least one real disk: %+v", first.Disks)
	}
	if first.NetRxBps != 0 || first.NetTxBps != 0 {
		t.Fatal("no rate without a previous reading")
	}
	second := c.sample(ctx, now.Add(time.Second))
	if second.NetRxBps < 0 || second.NetTxBps < 0 {
		t.Fatalf("rates are never negative: %+v", second)
	}
	info := readHostInfo(ctx)
	if info.OS == "" || info.Cores == 0 || info.MemTotal == 0 {
		t.Fatalf("host info: %+v", info)
	}
	for i := 0; i < hostSamplesKept+5; i++ {
		c.collect(ctx, now)
	}
	if len(c.pending) != hostSamplesKept {
		t.Fatalf("keeps at most %d unsent samples, has %d", hostSamplesKept, len(c.pending))
	}
	t.Logf("cpu %.1f%% mem %d/%d disks %d procs %d info %+v", first.CPU, first.MemUsed, first.MemTotal, len(first.Disks), first.Procs, info)
}
