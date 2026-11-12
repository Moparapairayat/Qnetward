package main

import (
	"context"
	"fmt"
	"math"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gosnmp/gosnmp"
)

// deviceJob is a network device the console asked this agent to poll.
type deviceJob struct {
	DeviceID        int64  `json:"device_id"`
	Address         string `json:"address"`
	Port            int    `json:"port"`
	Version         string `json:"version"` // 2c or 3
	Community       string `json:"community,omitempty"`
	Username        string `json:"username,omitempty"`
	AuthProtocol    string `json:"auth_protocol,omitempty"` // none, md5, sha, sha256, sha512
	AuthPassword    string `json:"auth_password,omitempty"`
	PrivProtocol    string `json:"priv_protocol,omitempty"` // none, des, aes, aes256
	PrivPassword    string `json:"priv_password,omitempty"`
	IntervalSeconds int    `json:"interval_seconds"`
}

// deviceSys is what a device says about itself.
type deviceSys struct {
	Descr    string `json:"descr"`
	ObjectID string `json:"object_id"`
	UptimeS  int64  `json:"uptime_s"`
	Name     string `json:"name"`
	Location string `json:"location"`
	Contact  string `json:"contact"`
}

// deviceIf is one interface and its rates since the previous poll.
type deviceIf struct {
	Index         int     `json:"index"`
	Name          string  `json:"name"`
	Descr         string  `json:"descr"`
	Alias         string  `json:"alias"`
	Type          int     `json:"type"`
	Admin         string  `json:"admin"`
	Oper          string  `json:"oper"`
	SpeedBps      uint64  `json:"speed_bps"`
	InBps         float64 `json:"in_bps"`
	OutBps        float64 `json:"out_bps"`
	InErrorsPS    float64 `json:"in_errors_ps"`
	OutErrorsPS   float64 `json:"out_errors_ps"`
	InDiscardsPS  float64 `json:"in_discards_ps"`
	OutDiscardsPS float64 `json:"out_discards_ps"`
	HasRates      bool    `json:"has_rates"`
}

// deviceSample is one poll of a device.
type deviceSample struct {
	DeviceID   int64      `json:"device_id"`
	At         time.Time  `json:"at"`
	Reachable  bool       `json:"reachable"`
	Error      string     `json:"error,omitempty"`
	RTTMs      float64    `json:"rtt_ms"`
	Sys        *deviceSys `json:"sys,omitempty"`
	Interfaces []deviceIf `json:"interfaces"`
}

const (
	oidSys      = "1.3.6.1.2.1.1"
	oidIfTable  = "1.3.6.1.2.1.2.2.1"
	oidIfXTable = "1.3.6.1.2.1.31.1.1.1"
	// deviceIfMax caps the interfaces reported per device.
	deviceIfMax = 512
	// deviceSamplesKept caps unsent device samples.
	deviceSamplesKept = 500
)

var ifStatus = map[int]string{1: "up", 2: "down", 3: "testing", 4: "unknown", 5: "dormant", 6: "notPresent", 7: "lowerLayerDown"}

// counters are an interface's raw counters at a poll.
type counters struct {
	in, out, inErr, outErr, inDisc, outDisc uint64
	hc                                      bool
}

// devicePoller polls devices on their own schedules and keeps the previous
// counters of each, so it can report rates.
type devicePoller struct {
	mu      sync.Mutex
	jobs    map[int64]deviceJob
	next    map[int64]time.Time
	running map[int64]bool
	prev    map[int64]map[int]counters
	prevAt  map[int64]time.Time
	results []deviceSample
}

func newDevicePoller() *devicePoller {
	return &devicePoller{jobs: map[int64]deviceJob{}, next: map[int64]time.Time{}, running: map[int64]bool{}, prev: map[int64]map[int]counters{}, prevAt: map[int64]time.Time{}}
}

// sync replaces the device list, keeping the schedule and counters of
// devices whose settings didn't change.
func (p *devicePoller) sync(jobs []deviceJob) {
	p.mu.Lock()
	defer p.mu.Unlock()
	keep := map[int64]bool{}
	for _, j := range jobs {
		keep[j.DeviceID] = true
		if old, ok := p.jobs[j.DeviceID]; !ok || old != j {
			p.next[j.DeviceID] = time.Now()
			delete(p.prev, j.DeviceID)
		}
		p.jobs[j.DeviceID] = j
	}
	for id := range p.jobs {
		if !keep[id] {
			delete(p.jobs, id)
			delete(p.next, id)
			delete(p.prev, id)
			delete(p.prevAt, id)
		}
	}
}

func (p *devicePoller) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.jobs)
}

// startDue polls every device whose turn has come.
func (p *devicePoller) startDue(ctx context.Context, wg *sync.WaitGroup) {
	now := time.Now()
	p.mu.Lock()
	var due []deviceJob
	for id, j := range p.jobs {
		if !p.running[id] && !now.Before(p.next[id]) {
			p.running[id] = true
			every := time.Duration(j.IntervalSeconds) * time.Second
			if every < 30*time.Second {
				every = 60 * time.Second
			}
			p.next[id] = now.Add(every)
			due = append(due, j)
		}
	}
	p.mu.Unlock()
	for _, j := range due {
		wg.Add(1)
		go func(j deviceJob) {
			defer wg.Done()
			s := p.poll(ctx, j)
			p.mu.Lock()
			delete(p.running, j.DeviceID)
			if _, still := p.jobs[j.DeviceID]; still {
				p.results = append(p.results, s)
				if len(p.results) > deviceSamplesKept {
					p.results = p.results[len(p.results)-deviceSamplesKept:]
				}
			}
			p.mu.Unlock()
		}(j)
	}
}

func (p *devicePoller) take(n int) []deviceSample {
	p.mu.Lock()
	defer p.mu.Unlock()
	if n > len(p.results) {
		n = len(p.results)
	}
	out := append([]deviceSample(nil), p.results[:n]...)
	p.results = p.results[n:]
	return out
}

func (p *devicePoller) putBack(s []deviceSample) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.results = append(s, p.results...)
	if len(p.results) > deviceSamplesKept {
		p.results = p.results[len(p.results)-deviceSamplesKept:]
	}
}

func snmpClient(ctx context.Context, j deviceJob) (*gosnmp.GoSNMP, error) {
	port := j.Port
	if port == 0 {
		port = 161
	}
	g := &gosnmp.GoSNMP{
		Context:            ctx,
		Target:             j.Address,
		Port:               uint16(port),
		Transport:          "udp",
		Timeout:            3 * time.Second,
		Retries:            1,
		MaxOids:            gosnmp.MaxOids,
		MaxRepetitions:     25,
		ExponentialTimeout: false,
	}
	switch j.Version {
	case "3":
		g.Version = gosnmp.Version3
		g.SecurityModel = gosnmp.UserSecurityModel
		usm := &gosnmp.UsmSecurityParameters{UserName: j.Username, AuthenticationPassphrase: j.AuthPassword, PrivacyPassphrase: j.PrivPassword}
		usm.AuthenticationProtocol = map[string]gosnmp.SnmpV3AuthProtocol{
			"md5": gosnmp.MD5, "sha": gosnmp.SHA, "sha256": gosnmp.SHA256, "sha512": gosnmp.SHA512,
		}[j.AuthProtocol]
		if usm.AuthenticationProtocol == 0 {
			usm.AuthenticationProtocol = gosnmp.NoAuth
		}
		usm.PrivacyProtocol = map[string]gosnmp.SnmpV3PrivProtocol{
			"des": gosnmp.DES, "aes": gosnmp.AES, "aes256": gosnmp.AES256,
		}[j.PrivProtocol]
		if usm.PrivacyProtocol == 0 {
			usm.PrivacyProtocol = gosnmp.NoPriv
		}
		switch {
		case usm.AuthenticationProtocol != gosnmp.NoAuth && usm.PrivacyProtocol != gosnmp.NoPriv:
			g.MsgFlags = gosnmp.AuthPriv
		case usm.AuthenticationProtocol != gosnmp.NoAuth:
			g.MsgFlags = gosnmp.AuthNoPriv
		default:
			g.MsgFlags = gosnmp.NoAuthNoPriv
		}
		g.SecurityParameters = usm
	default:
		g.Version = gosnmp.Version2c
		g.Community = j.Community
	}
	return g, g.Connect()
}

// poll reads a device's system group and interface tables.
func (p *devicePoller) poll(ctx context.Context, j deviceJob) deviceSample {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	now := time.Now()
	s := deviceSample{DeviceID: j.DeviceID, At: now.UTC().Truncate(time.Second), Interfaces: []deviceIf{}}
	g, err := snmpClient(ctx, j)
	if err != nil {
		s.Error = err.Error()
		return s
	}
	defer g.Conn.Close()

	start := time.Now()
	sysOIDs := []string{oidSys + ".1.0", oidSys + ".2.0", oidSys + ".3.0", oidSys + ".4.0", oidSys + ".5.0", oidSys + ".6.0"}
	res, err := g.Get(sysOIDs)
	if err != nil {
		s.Error = friendlySNMPError(err)
		return s
	}
	s.RTTMs = float64(time.Since(start).Microseconds()) / 1000
	s.Reachable = true
	sys := &deviceSys{}
	for _, v := range res.Variables {
		switch strings.TrimPrefix(v.Name, ".") {
		case oidSys + ".1.0":
			sys.Descr = clipStr(pduString(v), 300)
		case oidSys + ".2.0":
			sys.ObjectID = strings.TrimPrefix(pduString(v), ".")
		case oidSys + ".3.0":
			sys.UptimeS = int64(gosnmp.ToBigInt(v.Value).Uint64() / 100)
		case oidSys + ".4.0":
			sys.Contact = clipStr(pduString(v), 120)
		case oidSys + ".5.0":
			sys.Name = clipStr(pduString(v), 120)
		case oidSys + ".6.0":
			sys.Location = clipStr(pduString(v), 120)
		}
	}
	s.Sys = sys

	ifs := map[int]*deviceIf{}
	cur := map[int]counters{}
	get := func(idx int) *deviceIf {
		if ifs[idx] == nil {
			if len(ifs) >= deviceIfMax {
				return nil
			}
			ifs[idx] = &deviceIf{Index: idx}
		}
		return ifs[idx]
	}
	walk := func(root string, fn func(col, idx int, v gosnmp.SnmpPDU)) error {
		return g.BulkWalk(root, func(v gosnmp.SnmpPDU) error {
			rest := strings.TrimPrefix(strings.TrimPrefix(v.Name, "."), root+".")
			parts := strings.SplitN(rest, ".", 2)
			if len(parts) != 2 {
				return nil
			}
			col, err1 := strconv.Atoi(parts[0])
			idx, err2 := strconv.Atoi(parts[1])
			if err1 == nil && err2 == nil {
				fn(col, idx, v)
			}
			return nil
		})
	}
	err = walk(oidIfTable, func(col, idx int, v gosnmp.SnmpPDU) {
		f := get(idx)
		if f == nil {
			return
		}
		c := cur[idx]
		n := gosnmp.ToBigInt(v.Value).Uint64()
		switch col {
		case 2:
			f.Descr = clipStr(pduString(v), 120)
		case 3:
			f.Type = int(n)
		case 5:
			if f.SpeedBps == 0 {
				f.SpeedBps = n
			}
		case 7:
			f.Admin = ifStatus[int(n)]
		case 8:
			f.Oper = ifStatus[int(n)]
		case 10:
			if !c.hc {
				c.in = n
			}
		case 13:
			c.inDisc = n
		case 14:
			c.inErr = n
		case 16:
			if !c.hc {
				c.out = n
			}
		case 19:
			c.outDisc = n
		case 20:
			c.outErr = n
		}
		cur[idx] = c
	})
	if err != nil {
		s.Error = "interfaces: " + friendlySNMPError(err)
	}
	// The 64-bit table is optional; old devices only have 32-bit counters.
	_ = walk(oidIfXTable, func(col, idx int, v gosnmp.SnmpPDU) {
		f := ifs[idx]
		if f == nil {
			return
		}
		c := cur[idx]
		n := gosnmp.ToBigInt(v.Value).Uint64()
		switch col {
		case 1:
			f.Name = clipStr(pduString(v), 120)
		case 6:
			c.in, c.hc = n, true
		case 10:
			c.out, c.hc = n, true
		case 15:
			if n > 0 {
				f.SpeedBps = n * 1_000_000
			}
		case 18:
			f.Alias = clipStr(pduString(v), 120)
		}
		cur[idx] = c
	})

	p.mu.Lock()
	prev, prevAt := p.prev[j.DeviceID], p.prevAt[j.DeviceID]
	p.prev[j.DeviceID], p.prevAt[j.DeviceID] = cur, now
	p.mu.Unlock()
	secs := now.Sub(prevAt).Seconds()
	for idx, f := range ifs {
		if f.Name == "" {
			f.Name = f.Descr
		}
		c, pc := cur[idx], prev[idx]
		if prev != nil && secs > 0 && secs < 3600 {
			if _, had := prev[idx]; had && pc.hc == c.hc {
				f.HasRates = true
				f.InBps = rate(pc.in, c.in, c.hc, secs) * 8
				f.OutBps = rate(pc.out, c.out, c.hc, secs) * 8
				f.InErrorsPS = rate(pc.inErr, c.inErr, false, secs)
				f.OutErrorsPS = rate(pc.outErr, c.outErr, false, secs)
				f.InDiscardsPS = rate(pc.inDisc, c.inDisc, false, secs)
				f.OutDiscardsPS = rate(pc.outDisc, c.outDisc, false, secs)
			}
		}
		s.Interfaces = append(s.Interfaces, *f)
	}
	sort.Slice(s.Interfaces, func(a, b int) bool { return s.Interfaces[a].Index < s.Interfaces[b].Index })
	return s
}

// rate is how fast a counter grew. A 32-bit counter that went backwards
// wrapped; a 64-bit one was reset, which gives no rate.
func rate(prev, cur uint64, hc bool, secs float64) float64 {
	if cur >= prev {
		return float64(cur-prev) / secs
	}
	if hc || prev > math.MaxUint32 {
		return 0
	}
	return float64(cur+(math.MaxUint32-prev)+1) / secs
}

func pduString(v gosnmp.SnmpPDU) string {
	switch val := v.Value.(type) {
	case []byte:
		return strings.TrimRight(string(val), "\x00")
	case string:
		return val
	case nil:
		return ""
	default:
		return fmt.Sprint(val)
	}
}

func clipStr(s string, n int) string {
	s = strings.TrimSpace(strings.ToValidUTF8(s, ""))
	if len(s) > n {
		return s[:n]
	}
	return s
}

func friendlySNMPError(err error) string {
	var ne net.Error
	msg := err.Error()
	if strings.Contains(msg, "timeout") || (asNetErr(err, &ne) && ne.Timeout()) {
		return "no answer: check the address, that SNMP is on, and the community or credentials"
	}
	if strings.Contains(msg, "authentication") || strings.Contains(msg, "unknown user") {
		return "the device refused the SNMPv3 credentials"
	}
	return msg
}

func asNetErr(err error, target *net.Error) bool {
	ne, ok := err.(net.Error)
	if ok {
		*target = ne
	}
	return ok
}
