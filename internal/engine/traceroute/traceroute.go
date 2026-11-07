// Package traceroute finds the routers between here and a host. It sends ICMP
// echo requests with rising TTLs; each router that drops one answers with
// Time Exceeded, and the host itself answers with an echo reply. Every TTL is
// probed in parallel, a few rounds over, so a full trace takes a few seconds.
package traceroute

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"net"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"
)

// Limits on a run.
const (
	DefaultMaxHops = 30
	MaxHops        = 64
	DefaultQueries = 3
	MaxQueries     = 5
	DefaultTimeout = 1500 * time.Millisecond
)

type Config struct {
	MaxHops   int
	Queries   int
	Timeout   time.Duration
	ForceIPv6 bool
	// ResolveNames looks up a reverse DNS name for each hop.
	ResolveNames bool
	// AddrCheck, when set, vets the destination before any packet is sent.
	AddrCheck func(net.IP) error
}

// Hop is one TTL: who answered, and how long each probe took. A lost probe
// has a negative RTT.
type Hop struct {
	TTL     int       `json:"ttl"`
	Addr    string    `json:"addr,omitempty"`
	Name    string    `json:"name,omitempty"`
	RTTs    []float64 `json:"rtts_ms"`
	Loss    float64   `json:"loss_percent"`
	Best    float64   `json:"best_ms,omitempty"`
	Avg     float64   `json:"avg_ms,omitempty"`
	Worst   float64   `json:"worst_ms,omitempty"`
	Reached bool      `json:"reached,omitempty"`
}

type Result struct {
	Target     string  `json:"target"`
	Addr       string  `json:"addr"`
	IPv6       bool    `json:"ipv6"`
	Reached    bool    `json:"reached"`
	Hops       []Hop   `json:"hops"`
	DurationMs float64 `json:"duration_ms"`
}

type family struct {
	network      string
	proto        int
	echo         icmp.Type
	echoReply    icmp.Type
	timeExceeded icmp.Type
	unreachable  icmp.Type
	// innerHeader is the size of the IP header quoted in an error message;
	// zero means read it from the IPv4 header itself.
	innerHeader int
}

var v4 = family{"ip4:icmp", 1, ipv4.ICMPTypeEcho, ipv4.ICMPTypeEchoReply, ipv4.ICMPTypeTimeExceeded, ipv4.ICMPTypeDestinationUnreachable, 0}
var v6 = family{"ip6:ipv6-icmp", 58, ipv6.ICMPTypeEchoRequest, ipv6.ICMPTypeEchoReply, ipv6.ICMPTypeTimeExceeded, ipv6.ICMPTypeDestinationUnreachable, 40}

type reply struct {
	addr string
	rtt  time.Duration
	dest bool
}

// Run traces the route to host.
func Run(ctx context.Context, host string, cfg Config) (Result, error) {
	if cfg.MaxHops <= 0 {
		cfg.MaxHops = DefaultMaxHops
	}
	if cfg.MaxHops > MaxHops {
		return Result{}, fmt.Errorf("max hops must be %d or fewer", MaxHops)
	}
	if cfg.Queries <= 0 {
		cfg.Queries = DefaultQueries
	}
	if cfg.Queries > MaxQueries {
		return Result{}, fmt.Errorf("queries per hop must be %d or fewer", MaxQueries)
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = DefaultTimeout
	}

	dst, isIPv6, err := resolve(host, cfg.ForceIPv6)
	if err != nil {
		return Result{}, err
	}
	if cfg.AddrCheck != nil {
		if err := cfg.AddrCheck(dst.IP); err != nil {
			return Result{}, err
		}
	}
	fam := v4
	if isIPv6 {
		fam = v6
	}

	conn, err := icmp.ListenPacket(fam.network, "")
	if err != nil {
		if errors.Is(err, os.ErrPermission) || strings.Contains(strings.ToLower(err.Error()), "permission") || strings.Contains(err.Error(), "access") {
			return Result{}, fmt.Errorf("traceroute needs raw ICMP sockets (root or CAP_NET_RAW): %w", err)
		}
		return Result{}, err
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()

	setTTL := func(ttl int) error { return conn.IPv4PacketConn().SetTTL(ttl) }
	if isIPv6 {
		setTTL = func(ttl int) error { return conn.IPv6PacketConn().SetHopLimit(ttl) }
	}

	id := rand.IntN(0xffff) + 1
	started := time.Now()
	// replies[ttl-1][query]
	replies := make([][]*reply, cfg.MaxHops)
	for i := range replies {
		replies[i] = make([]*reply, cfg.Queries)
	}
	destTTL := 0

	for q := 0; q < cfg.Queries; q++ {
		limit := cfg.MaxHops
		if destTTL > 0 {
			limit = destTTL
		}
		sent := map[int]time.Time{}
		for ttl := 1; ttl <= limit; ttl++ {
			if err := ctx.Err(); err != nil {
				return Result{}, err
			}
			if err := setTTL(ttl); err != nil {
				return Result{}, fmt.Errorf("setting the TTL failed: %w", err)
			}
			seq := q<<8 | ttl
			msg := icmp.Message{Type: fam.echo, Body: &icmp.Echo{ID: id, Seq: seq, Data: []byte("qnetward-trace")}}
			b, err := msg.Marshal(nil)
			if err != nil {
				return Result{}, err
			}
			sent[seq] = time.Now()
			if _, err := conn.WriteTo(b, dst); err != nil {
				if ctx.Err() != nil {
					return Result{}, ctx.Err()
				}
				delete(sent, seq)
			}
			// A little spacing keeps routers that rate-limit ICMP from dropping answers.
			time.Sleep(3 * time.Millisecond)
		}

		deadline := time.Now().Add(cfg.Timeout)
		buf := make([]byte, 1500)
		for len(sent) > 0 {
			_ = conn.SetReadDeadline(deadline)
			n, peer, err := conn.ReadFrom(buf)
			if err != nil {
				if ctx.Err() != nil {
					return Result{}, ctx.Err()
				}
				var ne net.Error
				if errors.As(err, &ne) && ne.Timeout() {
					break
				}
				return Result{}, err
			}
			at := time.Now()
			seq, dest, ok := match(fam, buf[:n], id, dst.IP, peer)
			if !ok {
				continue
			}
			sentAt, ok := sent[seq]
			if !ok {
				continue
			}
			delete(sent, seq)
			ttl, query := seq&0xff, seq>>8
			if ttl < 1 || ttl > cfg.MaxHops || query >= cfg.Queries {
				continue
			}
			replies[ttl-1][query] = &reply{addr: hostOf(peer), rtt: at.Sub(sentAt), dest: dest}
			if dest && (destTTL == 0 || ttl < destTTL) {
				destTTL = ttl
			}
		}
	}

	res := Result{Target: host, Addr: dst.IP.String(), IPv6: isIPv6, Reached: destTTL > 0}
	last := destTTL
	if last == 0 {
		// Not reached: keep up to the last hop that answered, and a few silent ones after it.
		for ttl := cfg.MaxHops; ttl >= 1; ttl-- {
			if answered(replies[ttl-1]) {
				last = ttl
				break
			}
		}
		last = min(cfg.MaxHops, last+3)
	}
	for ttl := 1; ttl <= last; ttl++ {
		res.Hops = append(res.Hops, summarize(ttl, replies[ttl-1], ttl == destTTL))
	}
	if cfg.ResolveNames {
		resolveNames(ctx, res.Hops)
	}
	res.DurationMs = float64(time.Since(started).Microseconds()) / 1000
	return res, nil
}

// match reports which of our probes a packet answers, and whether it came
// from the destination itself.
func match(fam family, data []byte, id int, dst net.IP, peer net.Addr) (int, bool, bool) {
	msg, err := icmp.ParseMessage(fam.proto, data)
	if err != nil {
		return 0, false, false
	}
	switch msg.Type {
	case fam.echoReply:
		echo, ok := msg.Body.(*icmp.Echo)
		if !ok || echo.ID != id {
			return 0, false, false
		}
		return echo.Seq, net.ParseIP(hostOf(peer)).Equal(dst), true
	case fam.timeExceeded, fam.unreachable:
		var quoted []byte
		switch body := msg.Body.(type) {
		case *icmp.TimeExceeded:
			quoted = body.Data
		case *icmp.DstUnreach:
			quoted = body.Data
		default:
			return 0, false, false
		}
		qid, seq, ok := quotedEcho(quoted, fam.innerHeader)
		if !ok || qid != id {
			return 0, false, false
		}
		// An unreachable from the destination means it answered, if not with an echo.
		return seq, msg.Type == fam.unreachable && net.ParseIP(hostOf(peer)).Equal(dst), true
	}
	return 0, false, false
}

// quotedEcho reads the ID and sequence of the echo request an ICMP error
// quotes. The quote is our IP header followed by at least 8 bytes of ICMP.
func quotedEcho(quoted []byte, headerLen int) (int, int, bool) {
	if headerLen == 0 {
		if len(quoted) < 1 {
			return 0, 0, false
		}
		headerLen = int(quoted[0]&0x0f) * 4
	}
	if headerLen < 20 || len(quoted) < headerLen+8 {
		return 0, 0, false
	}
	inner := quoted[headerLen:]
	return int(binary.BigEndian.Uint16(inner[4:6])), int(binary.BigEndian.Uint16(inner[6:8])), true
}

func answered(rs []*reply) bool {
	for _, r := range rs {
		if r != nil {
			return true
		}
	}
	return false
}

func summarize(ttl int, rs []*reply, reached bool) Hop {
	hop := Hop{TTL: ttl, RTTs: make([]float64, len(rs)), Reached: reached}
	counts := map[string]int{}
	var got []float64
	for i, r := range rs {
		if r == nil {
			hop.RTTs[i] = -1
			continue
		}
		ms := math.Round(float64(r.rtt.Microseconds())/10) / 100
		hop.RTTs[i] = ms
		got = append(got, ms)
		counts[r.addr]++
	}
	// The address most probes saw; load-balanced paths can answer from several.
	best := 0
	for addr, n := range counts {
		if n > best || (n == best && addr < hop.Addr) {
			hop.Addr, best = addr, n
		}
	}
	hop.Loss = math.Round(float64(len(rs)-len(got))/float64(len(rs))*1000) / 10
	if len(got) > 0 {
		sort.Float64s(got)
		hop.Best, hop.Worst = got[0], got[len(got)-1]
		sum := 0.0
		for _, v := range got {
			sum += v
		}
		hop.Avg = math.Round(sum/float64(len(got))*100) / 100
	}
	return hop
}

// resolveNames fills in reverse DNS names, in parallel, giving up after a second each.
func resolveNames(ctx context.Context, hops []Hop) {
	var wg sync.WaitGroup
	for i := range hops {
		if hops[i].Addr == "" {
			continue
		}
		wg.Add(1)
		go func(h *Hop) {
			defer wg.Done()
			lctx, cancel := context.WithTimeout(ctx, time.Second)
			defer cancel()
			if names, err := net.DefaultResolver.LookupAddr(lctx, h.Addr); err == nil && len(names) > 0 {
				h.Name = strings.TrimSuffix(names[0], ".")
			}
		}(&hops[i])
	}
	wg.Wait()
}

func resolve(host string, forceIPv6 bool) (*net.IPAddr, bool, error) {
	if forceIPv6 {
		ip, err := net.ResolveIPAddr("ip6", host)
		return ip, true, err
	}
	if ip, err := net.ResolveIPAddr("ip4", host); err == nil {
		return ip, false, nil
	} else if ip6, err6 := net.ResolveIPAddr("ip6", host); err6 == nil {
		return ip6, true, nil
	} else {
		return nil, false, err
	}
}

func hostOf(addr net.Addr) string {
	switch a := addr.(type) {
	case *net.IPAddr:
		return a.IP.String()
	case *net.UDPAddr:
		return a.IP.String()
	default:
		h, _, err := net.SplitHostPort(addr.String())
		if err != nil {
			return addr.String()
		}
		return h
	}
}
