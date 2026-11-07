package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
)

const defaultScanPorts = "22,80,443,8080"

type boolFlag interface {
	IsBoolFlag() bool
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "ping":
		runPing(os.Args[2:])
	case "tcpping":
		runTCPPing(os.Args[2:])
	case "portscan":
		runPortScan(os.Args[2:])
	case "dns":
		runDNSLookup(os.Args[2:])
	case "serve":
		runServe(os.Args[2:])
	case "migrate":
		runMigrate(os.Args[2:])
	case "agent":
		runAgent(os.Args[2:])
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "Qnetward - Networking toolkit")
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "Usage:")
	fmt.Fprintln(os.Stderr, "  qnetward ping [flags] <host>")
	fmt.Fprintln(os.Stderr, "  qnetward tcpping [flags] <host>[:port]")
	fmt.Fprintln(os.Stderr, "  qnetward portscan [flags] <host>")
	fmt.Fprintln(os.Stderr, "  qnetward dns [flags] <host-or-ip>")
	fmt.Fprintln(os.Stderr, "  qnetward serve [flags]")
	fmt.Fprintln(os.Stderr, "  qnetward migrate [-status]")
	fmt.Fprintln(os.Stderr, "  qnetward agent --server <url> --token <enrollment token>")
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "Commands:")
	fmt.Fprintln(os.Stderr, "  ping     ICMP echo (requires root or CAP_NET_RAW)")
	fmt.Fprintln(os.Stderr, "  tcpping  TCP connect latency")
	fmt.Fprintln(os.Stderr, "  portscan TCP connect port scan")
	fmt.Fprintln(os.Stderr, "  dns      DNS lookup / reverse DNS")
	fmt.Fprintln(os.Stderr, "  serve    Web UI + REST API")
	fmt.Fprintln(os.Stderr, "  migrate  Apply database schema migrations")
	fmt.Fprintln(os.Stderr, "  agent    Run as a probe agent for a workspace")
}

func normalizeArgs(fs *flag.FlagSet, args []string) []string {
	if len(args) == 0 {
		return args
	}

	takesValue := make(map[string]bool)
	fs.VisitAll(func(f *flag.Flag) {
		_, isBool := f.Value.(boolFlag)
		takesValue[f.Name] = !isBool
	})

	flags := make([]string, 0, len(args))
	pos := make([]string, 0, len(args))

	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			pos = append(pos, args[i+1:]...)
			break
		}
		if strings.HasPrefix(a, "-") {
			flags = append(flags, a)
			name := strings.TrimLeft(a, "-")
			if idx := strings.Index(name, "="); idx >= 0 {
				name = name[:idx]
			}
			if takesValue[name] && !strings.Contains(a, "=") && i+1 < len(args) {
				flags = append(flags, args[i+1])
				i++
			}
			continue
		}
		pos = append(pos, a)
	}

	return append(flags, pos...)
}
