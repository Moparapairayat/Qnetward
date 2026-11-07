package traceroute

import (
	"context"
	"encoding/binary"
	"net"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
)

func TestQuotedEchoReadsIDAndSeq(t *testing.T) {
	// An IPv4 header (IHL 5, so 20 bytes) followed by an echo request header.
	quoted := make([]byte, 28)
	quoted[0] = 0x45
	binary.BigEndian.PutUint16(quoted[24:26], 0xBEEF)
	binary.BigEndian.PutUint16(quoted[26:28], 0x0207)
	id, seq, ok := quotedEcho(quoted, 0)
	if !ok || id != 0xBEEF || seq != 0x0207 {
		t.Fatalf("got id %#x seq %#x ok %v", id, seq, ok)
	}
	if _, _, ok := quotedEcho(quoted[:25], 0); ok {
		t.Fatal("a truncated quote must not match")
	}
	// IPv6 quotes a fixed 40-byte header.
	v6 := make([]byte, 48)
	binary.BigEndian.PutUint16(v6[44:46], 7)
	binary.BigEndian.PutUint16(v6[46:48], 9)
	if id, seq, ok := quotedEcho(v6, 40); !ok || id != 7 || seq != 9 {
		t.Fatalf("ipv6: got id %d seq %d ok %v", id, seq, ok)
	}
}

func TestSummarizeHop(t *testing.T) {
	rs := []*reply{{addr: "10.0.0.1", rtt: 4 * time.Millisecond}, nil, {addr: "10.0.0.1", rtt: 8 * time.Millisecond}}
	h := summarize(2, rs, false)
	if h.Addr != "10.0.0.1" || h.Best != 4 || h.Worst != 8 || h.Avg != 6 || h.RTTs[1] != -1 || h.Loss != 33.3 {
		t.Fatalf("unexpected hop %+v", h)
	}
	silent := summarize(3, []*reply{nil, nil}, false)
	if silent.Addr != "" || silent.Loss != 100 {
		t.Fatalf("unexpected silent hop %+v", silent)
	}
}

func TestRejectsOutOfRangeSettings(t *testing.T) {
	if _, err := Run(context.Background(), "127.0.0.1", Config{MaxHops: 100}); err == nil {
		t.Fatal("expected too many hops to be refused")
	}
	if _, err := Run(context.Background(), "127.0.0.1", Config{Queries: 9}); err == nil {
		t.Fatal("expected too many queries to be refused")
	}
}

// Loopback is one hop away. Raw ICMP needs privileges; skip where they're missing.
func TestTraceLoopback(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	res, err := Run(ctx, "127.0.0.1", Config{MaxHops: 5, Queries: 2, Timeout: time.Second})
	if err != nil {
		if strings.Contains(err.Error(), "raw ICMP") || strings.Contains(strings.ToLower(err.Error()), "operation not permitted") {
			t.Skipf("no raw socket privileges: %v", err)
		}
		t.Fatalf("trace failed: %v", err)
	}
	if !res.Reached || len(res.Hops) != 1 || res.Hops[0].Addr != "127.0.0.1" || !res.Hops[0].Reached {
		t.Fatalf("expected one hop to 127.0.0.1, got %+v", res)
	}
}

// match pairs replies with our probes: a router's Time Exceeded quotes the
// probe, the destination answers with an echo reply, and other traffic is ignored.
func TestMatchRepliesToProbes(t *testing.T) {
	dst := net.ParseIP("203.0.113.9")
	router := &net.IPAddr{IP: net.ParseIP("198.51.100.1")}
	probe, _ := (&icmp.Message{Type: ipv4.ICMPTypeEcho, Body: &icmp.Echo{ID: 77, Seq: 1<<8 | 4, Data: []byte("qnetward-trace")}}).Marshal(nil)
	header := make([]byte, 20)
	header[0] = 0x45
	quote := append(header, probe[:8]...)

	exceeded, _ := (&icmp.Message{Type: ipv4.ICMPTypeTimeExceeded, Body: &icmp.TimeExceeded{Data: quote}}).Marshal(nil)
	if seq, dest, ok := match(v4, exceeded, 77, dst, router); !ok || dest || seq != 1<<8|4 {
		t.Fatalf("time exceeded: seq %#x dest %v ok %v", seq, dest, ok)
	}
	if _, _, ok := match(v4, exceeded, 78, dst, router); ok {
		t.Fatal("another program's probe must not match")
	}

	echoReply, _ := (&icmp.Message{Type: ipv4.ICMPTypeEchoReply, Body: &icmp.Echo{ID: 77, Seq: 9}}).Marshal(nil)
	if seq, dest, ok := match(v4, echoReply, 77, dst, &net.IPAddr{IP: dst}); !ok || !dest || seq != 9 {
		t.Fatalf("echo reply: seq %d dest %v ok %v", seq, dest, ok)
	}
	if _, _, ok := match(v4, []byte{1, 2}, 77, dst, router); ok {
		t.Fatal("garbage must not match")
	}
}
