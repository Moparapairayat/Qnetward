package main

import (
	"context"
	"net"
	"strconv"
	"sync"
	"testing"
	"time"

	"qnetward/internal/platform/snmpfake"
)

// The poller reads a switch's system group and interfaces, and reports rates
// from the second poll on. A wrong community gets no answer.
func TestDevicePollerReadsSwitch(t *testing.T) {
	start := time.Now().Add(-time.Minute)
	srv := &snmpfake.Server{Community: "public", Data: snmpfake.Switch("core-sw-1", start, []snmpfake.Port{
		{Name: "Gi1/0/1", Alias: "Uplink", SpeedMb: 1000, Up: true, InBps: 80_000_000, OutBps: 20_000_000},
		{Name: "Gi1/0/2", SpeedMb: 1000, Up: false},
	})}
	addr, err := srv.Listen("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	host, portStr, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(portStr)

	p := newDevicePoller()
	job := deviceJob{DeviceID: 7, Address: host, Port: port, Version: "2c", Community: "public", IntervalSeconds: 60}
	ctx := context.Background()
	first := p.poll(ctx, job)
	if !first.Reachable || first.Error != "" || first.Sys == nil || first.Sys.Name != "core-sw-1" || first.Sys.UptimeS < 12*86400 {
		t.Fatalf("first poll: %+v sys %+v", first, first.Sys)
	}
	if len(first.Interfaces) != 2 || first.Interfaces[0].Name != "Gi1/0/1" || first.Interfaces[0].Alias != "Uplink" || first.Interfaces[0].SpeedBps != 1_000_000_000 ||
		first.Interfaces[0].Oper != "up" || first.Interfaces[1].Oper != "down" || first.Interfaces[0].HasRates {
		t.Fatalf("interfaces: %+v", first.Interfaces)
	}
	time.Sleep(1500 * time.Millisecond)
	second := p.poll(ctx, job)
	in := second.Interfaces[0].InBps
	if !second.Interfaces[0].HasRates || in < 60_000_000 || in > 100_000_000 {
		t.Fatalf("rate near 80 Mbit/s: %+v", second.Interfaces[0])
	}

	bad := p.poll(ctx, deviceJob{DeviceID: 8, Address: host, Port: port, Version: "2c", Community: "wrong"})
	if bad.Reachable || bad.Error == "" {
		t.Fatalf("a wrong community is unreachable with a reason: %+v", bad)
	}

	// The scheduler polls each device once per interval and keeps results.
	p.sync([]deviceJob{job})
	var wg sync.WaitGroup
	p.startDue(ctx, &wg)
	p.startDue(ctx, &wg)
	wg.Wait()
	if got := p.take(10); len(got) != 1 || got[0].DeviceID != 7 {
		t.Fatalf("one poll per interval: %d", len(got))
	}
}

func TestCounterRate(t *testing.T) {
	if r := rate(100, 300, false, 2); r != 100 {
		t.Fatalf("plain: %v", r)
	}
	if r := rate(4294967290, 10, false, 1); r != 16 {
		t.Fatalf("32-bit wrap: %v", r)
	}
	if r := rate(500, 10, true, 1); r != 0 {
		t.Fatalf("a 64-bit reset gives no rate: %v", r)
	}
}
