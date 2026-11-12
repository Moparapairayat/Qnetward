package main

import (
	"context"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
)

// hostInfo describes the machine the agent runs on.
type hostInfo struct {
	OS              string `json:"os"`
	Platform        string `json:"platform"`
	PlatformVersion string `json:"platform_version"`
	Kernel          string `json:"kernel"`
	Arch            string `json:"arch"`
	CPUModel        string `json:"cpu_model"`
	Cores           int    `json:"cores"`
	MemTotal        uint64 `json:"mem_total"`
	BootTime        int64  `json:"boot_time"`
	Virtualization  string `json:"virtualization,omitempty"`
}

type diskUsage struct {
	Mount  string `json:"mount"`
	FSType string `json:"fstype"`
	Used   uint64 `json:"used"`
	Total  uint64 `json:"total"`
}

// hostSample is one reading of the machine's load.
type hostSample struct {
	At        time.Time   `json:"at"`
	CPU       float64     `json:"cpu"`
	Load1     float64     `json:"load1"`
	Load5     float64     `json:"load5"`
	Load15    float64     `json:"load15"`
	MemUsed   uint64      `json:"mem_used"`
	MemTotal  uint64      `json:"mem_total"`
	SwapUsed  uint64      `json:"swap_used"`
	SwapTotal uint64      `json:"swap_total"`
	Disks     []diskUsage `json:"disks"`
	NetRxBps  float64     `json:"net_rx_bps"`
	NetTxBps  float64     `json:"net_tx_bps"`
	Procs     int         `json:"procs"`
	Uptime    uint64      `json:"uptime"`
}

// hostCollector reads the machine's load. Network rates need two readings,
// so the first sample reports none.
type hostCollector struct {
	lastNet  *net.IOCountersStat
	lastAt   time.Time
	pending  []hostSample
	info     *hostInfo
	infoSent time.Time
}

// hostSamplesKept is how many unsent samples an agent keeps while the
// console is unreachable: an hour at the default interval.
const hostSamplesKept = 60

// pseudo file systems that say nothing about disk space.
var skipFS = map[string]bool{
	"tmpfs": true, "devtmpfs": true, "overlay": true, "squashfs": true, "proc": true, "sysfs": true, "cgroup": true, "cgroup2": true,
	"devfs": true, "autofs": true, "nsfs": true, "tracefs": true, "debugfs": true, "fuse.lxcfs": true, "efivarfs": true, "ramfs": true,
}

func newHostCollector() *hostCollector {
	// Prime the CPU counters so the first reading covers the time since now.
	_, _ = cpu.Percent(0, false)
	return &hostCollector{}
}

func readHostInfo(ctx context.Context) hostInfo {
	info := hostInfo{OS: runtime.GOOS, Arch: runtime.GOARCH, Cores: runtime.NumCPU()}
	if h, err := host.InfoWithContext(ctx); err == nil {
		info.Platform, info.PlatformVersion, info.Kernel, info.BootTime = h.Platform, h.PlatformVersion, h.KernelVersion, int64(h.BootTime)
		if h.VirtualizationRole == "guest" {
			info.Virtualization = h.VirtualizationSystem
		}
	}
	if cs, err := cpu.InfoWithContext(ctx); err == nil && len(cs) > 0 {
		info.CPUModel = strings.TrimSpace(cs[0].ModelName)
	}
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		info.MemTotal = vm.Total
	}
	return info
}

func (c *hostCollector) sample(ctx context.Context, now time.Time) hostSample {
	s := hostSample{At: now.UTC().Truncate(time.Second), Disks: []diskUsage{}}
	if p, err := cpu.PercentWithContext(ctx, 0, false); err == nil && len(p) > 0 {
		s.CPU = p[0]
	}
	if l, err := load.AvgWithContext(ctx); err == nil {
		s.Load1, s.Load5, s.Load15 = l.Load1, l.Load5, l.Load15
	}
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		s.MemUsed, s.MemTotal = vm.Used, vm.Total
	}
	if sw, err := mem.SwapMemoryWithContext(ctx); err == nil {
		s.SwapUsed, s.SwapTotal = sw.Used, sw.Total
	}
	if parts, err := disk.PartitionsWithContext(ctx, false); err == nil {
		seen := map[string]bool{}
		for _, p := range parts {
			if skipFS[p.Fstype] || seen[p.Device] || strings.HasPrefix(p.Mountpoint, "/snap/") || strings.HasPrefix(p.Mountpoint, "/boot/efi") {
				continue
			}
			u, err := disk.UsageWithContext(ctx, p.Mountpoint)
			if err != nil || u.Total == 0 {
				continue
			}
			seen[p.Device] = true
			s.Disks = append(s.Disks, diskUsage{Mount: p.Mountpoint, FSType: p.Fstype, Used: u.Used, Total: u.Total})
		}
		sort.Slice(s.Disks, func(i, j int) bool { return s.Disks[i].Mount < s.Disks[j].Mount })
		if len(s.Disks) > 20 {
			s.Disks = s.Disks[:20]
		}
	}
	if counters, err := net.IOCountersWithContext(ctx, false); err == nil && len(counters) > 0 {
		cur := counters[0]
		if c.lastNet != nil {
			if secs := now.Sub(c.lastAt).Seconds(); secs > 0 && cur.BytesRecv >= c.lastNet.BytesRecv && cur.BytesSent >= c.lastNet.BytesSent {
				s.NetRxBps = float64(cur.BytesRecv-c.lastNet.BytesRecv) / secs
				s.NetTxBps = float64(cur.BytesSent-c.lastNet.BytesSent) / secs
			}
		}
		c.lastNet, c.lastAt = &cur, now
	}
	if h, err := host.InfoWithContext(ctx); err == nil {
		s.Procs, s.Uptime = int(h.Procs), h.Uptime
	}
	return s
}

// collect takes a sample and queues it for sending.
func (c *hostCollector) collect(ctx context.Context, now time.Time) {
	c.pending = append(c.pending, c.sample(ctx, now))
	if len(c.pending) > hostSamplesKept {
		c.pending = c.pending[len(c.pending)-hostSamplesKept:]
	}
}

// send posts queued samples, with the machine's description once an hour.
func (c *hostCollector) send(ctx context.Context, client *agentClient, secret string) error {
	if len(c.pending) == 0 {
		return nil
	}
	body := map[string]any{"samples": c.pending}
	if c.info == nil || time.Since(c.infoSent) > time.Hour {
		info := readHostInfo(ctx)
		c.info = &info
		body["info"] = info
	}
	var resp struct {
		Accepted int `json:"accepted"`
	}
	if err := client.post(ctx, "/api/agent/metrics", secret, body, &resp); err != nil {
		if _, sentInfo := body["info"]; sentInfo {
			c.info = nil
		}
		return err
	}
	if _, sentInfo := body["info"]; sentInfo {
		c.infoSent = time.Now()
	}
	c.pending = c.pending[:0]
	return nil
}
