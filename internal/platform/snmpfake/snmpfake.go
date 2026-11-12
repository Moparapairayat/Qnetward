// Package snmpfake is a tiny SNMPv2c responder for tests and demos. It
// answers Get, GetNext, and GetBulk from a table of values that a function
// builds on every request, so counters can grow over time.
package snmpfake

import (
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gosnmp/gosnmp"
)

// Server answers SNMP requests on a UDP socket.
type Server struct {
	Community string
	Data      func(now time.Time) []gosnmp.SnmpPDU
	conn      net.PacketConn
	wg        sync.WaitGroup
}

// Listen starts answering on addr, such as 127.0.0.1:0.
func (s *Server) Listen(addr string) (string, error) {
	conn, err := net.ListenPacket("udp", addr)
	if err != nil {
		return "", err
	}
	s.conn = conn
	s.wg.Add(1)
	go s.serve()
	return conn.LocalAddr().String(), nil
}

// Close stops the server.
func (s *Server) Close() {
	if s.conn != nil {
		_ = s.conn.Close()
	}
	s.wg.Wait()
}

func (s *Server) serve() {
	defer s.wg.Done()
	buf := make([]byte, 65535)
	dec := &gosnmp.GoSNMP{Version: gosnmp.Version2c}
	for {
		n, from, err := s.conn.ReadFrom(buf)
		if err != nil {
			return
		}
		req, err := dec.SnmpDecodePacket(append([]byte(nil), buf[:n]...))
		if err != nil || req.Community != s.Community {
			continue // a wrong community gets no answer, like a real device
		}
		vars := s.answer(req)
		resp := &gosnmp.SnmpPacket{Version: gosnmp.Version2c, Community: s.Community, PDUType: gosnmp.GetResponse, RequestID: req.RequestID, Variables: vars}
		out, err := resp.MarshalMsg()
		if err != nil {
			continue
		}
		_, _ = s.conn.WriteTo(out, from)
	}
}

func (s *Server) answer(req *gosnmp.SnmpPacket) []gosnmp.SnmpPDU {
	data := s.Data(time.Now())
	for i := range data {
		data[i].Name = strings.TrimPrefix(data[i].Name, ".")
	}
	sort.Slice(data, func(a, b int) bool { return Less(data[a].Name, data[b].Name) })
	next := func(oid string) (gosnmp.SnmpPDU, bool) {
		oid = strings.TrimPrefix(oid, ".")
		i := sort.Search(len(data), func(i int) bool { return Less(oid, data[i].Name) })
		if i < len(data) {
			return data[i], true
		}
		return gosnmp.SnmpPDU{Name: oid, Type: gosnmp.EndOfMibView}, false
	}
	var out []gosnmp.SnmpPDU
	switch req.PDUType {
	case gosnmp.GetRequest:
		for _, v := range req.Variables {
			name := strings.TrimPrefix(v.Name, ".")
			found := gosnmp.SnmpPDU{Name: name, Type: gosnmp.NoSuchObject}
			for _, d := range data {
				if d.Name == name {
					found = d
					break
				}
			}
			out = append(out, found)
		}
	case gosnmp.GetNextRequest:
		for _, v := range req.Variables {
			pdu, _ := next(v.Name)
			out = append(out, pdu)
		}
	case gosnmp.GetBulkRequest:
		reps := int(req.MaxRepetitions)
		if reps <= 0 {
			reps = 10
		}
		for _, v := range req.Variables {
			oid := v.Name
			for r := 0; r < reps; r++ {
				pdu, ok := next(oid)
				out = append(out, pdu)
				if !ok {
					break
				}
				oid = pdu.Name
			}
		}
	}
	return out
}

// Less orders OIDs numerically, component by component.
func Less(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(pa) && i < len(pb); i++ {
		x, _ := strconv.Atoi(pa[i])
		y, _ := strconv.Atoi(pb[i])
		if x != y {
			return x < y
		}
	}
	return len(pa) < len(pb)
}

// Port describes one interface of a fake switch.
type Port struct {
	Name     string
	Alias    string
	SpeedMb  uint
	Up       bool
	InBps    float64 // bits per second the counters grow by
	OutBps   float64
	ErrorsPS float64
}

// Switch builds the system group and interface tables of a switch whose
// counters grow at each port's rate since start.
func Switch(name string, start time.Time, ports []Port) func(now time.Time) []gosnmp.SnmpPDU {
	return func(now time.Time) []gosnmp.SnmpPDU {
		secs := now.Sub(start).Seconds()
		up := uint32(now.Sub(start).Seconds()*100) + 360000*24*12 // 12 days and counting
		d := []gosnmp.SnmpPDU{
			{Name: "1.3.6.1.2.1.1.1.0", Type: gosnmp.OctetString, Value: []byte("Qnetward demo switch, 24-port gigabit, firmware 2.4.1")},
			{Name: "1.3.6.1.2.1.1.2.0", Type: gosnmp.ObjectIdentifier, Value: ".1.3.6.1.4.1.9.1.1745"},
			{Name: "1.3.6.1.2.1.1.3.0", Type: gosnmp.TimeTicks, Value: up},
			{Name: "1.3.6.1.2.1.1.4.0", Type: gosnmp.OctetString, Value: []byte("noc@example.com")},
			{Name: "1.3.6.1.2.1.1.5.0", Type: gosnmp.OctetString, Value: []byte(name)},
			{Name: "1.3.6.1.2.1.1.6.0", Type: gosnmp.OctetString, Value: []byte("Rack 2, Dhaka office")},
		}
		for i, p := range ports {
			idx := strconv.Itoa(i + 1)
			status := 2
			if p.Up {
				status = 1
			}
			in := uint64(p.InBps / 8 * secs)
			out := uint64(p.OutBps / 8 * secs)
			errs := uint32(p.ErrorsPS * secs)
			d = append(d,
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.2.2.1.2." + idx, Type: gosnmp.OctetString, Value: []byte(p.Name)},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.2.2.1.3." + idx, Type: gosnmp.Integer, Value: 6},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.2.2.1.5." + idx, Type: gosnmp.Gauge32, Value: uint32(p.SpeedMb) * 1_000_000},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.2.2.1.7." + idx, Type: gosnmp.Integer, Value: 1},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.2.2.1.8." + idx, Type: gosnmp.Integer, Value: status},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.2.2.1.10." + idx, Type: gosnmp.Counter32, Value: uint32(in)},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.2.2.1.13." + idx, Type: gosnmp.Counter32, Value: uint32(0)},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.2.2.1.14." + idx, Type: gosnmp.Counter32, Value: errs},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.2.2.1.16." + idx, Type: gosnmp.Counter32, Value: uint32(out)},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.2.2.1.19." + idx, Type: gosnmp.Counter32, Value: uint32(0)},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.2.2.1.20." + idx, Type: gosnmp.Counter32, Value: uint32(0)},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.31.1.1.1.1." + idx, Type: gosnmp.OctetString, Value: []byte(p.Name)},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.31.1.1.1.6." + idx, Type: gosnmp.Counter64, Value: in},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.31.1.1.1.10." + idx, Type: gosnmp.Counter64, Value: out},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.31.1.1.1.15." + idx, Type: gosnmp.Gauge32, Value: uint32(p.SpeedMb)},
				gosnmp.SnmpPDU{Name: "1.3.6.1.2.1.31.1.1.1.18." + idx, Type: gosnmp.OctetString, Value: []byte(p.Alias)},
			)
		}
		return d
	}
}
